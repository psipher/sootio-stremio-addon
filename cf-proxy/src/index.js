/**
 * Sootio CF Fetch Proxy Worker
 *
 * Routes HTML-extraction requests from Vercel through Cloudflare's egress IPs,
 * bypassing CF WAF IP-reputation blocks that affect Vercel serverless IP ranges.
 *
 * Why this works:
 *   File hosts like hubcloud.foo sit behind Cloudflare WAF and block Vercel's
 *   serverless IP ranges. Requests from a Cloudflare Worker use Cloudflare's own
 *   CDN egress IPs — CF WAF cannot IP-block its own infrastructure, so the challenge
 *   never fires.
 *
 * Security model:
 *   - Requests must carry 'X-Proxy-Token' header matching PROXY_AUTH_TOKEN secret.
 *   - Only an explicit ALLOWED_HOSTS allowlist of target hostnames can be proxied.
 *   - No open relay — unknown hosts get a 403.
 *
 * API:
 *   POST /proxy
 *   Headers: X-Proxy-Token: <secret>, Content-Type: application/json
 *   Body:    { "url": "https://hubcloud.foo/...", "headers": {...}, "method": "GET" }
 *   Returns: Proxied response body with upstream status and headers forwarded.
 *
 *   GET /health  →  { ok: true, ts: <epoch ms> }
 *
 * Deploy:
 *   npx wrangler deploy
 *   npx wrangler secret put PROXY_AUTH_TOKEN
 */

// Allowlisted target hostnames — prevents use as an open relay.
// Must be updated when new CF-blocked hosts are discovered.
// Verified via live test (2026-07-27):
//   cloud.unblockedgames.world → HTTP 200 ✅ bypass works
//   leechpro.blog             → HTTP 200 ✅ bypass works
//   links.modpro.blog         → HTTP 200 ✅ bypass works
//   hubcloud.foo              → CF Managed Challenge ❌ (intentionally excluded — needs real browser)
const ALLOWED_HOSTS = new Set([
    'cloud.unblockedgames.world',
    'leechpro.blog',
    'links.modpro.blog',
]);

// Hop-by-hop headers that must NOT be forwarded upstream or returned downstream.
// Also strips our auth header so it never reaches the target host.
const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'x-proxy-token', // our auth header — must not leak to target
]);

// Maximum response body size forwarded back to Vercel (10 MB).
// Prevents giant binary responses from blowing the Worker memory limit (128 MB).
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // ── Health check (no auth required) ────────────────────────────────
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── Auth check ──────────────────────────────────────────────────────
        const token = request.headers.get('X-Proxy-Token');
        if (!env.PROXY_AUTH_TOKEN || token !== env.PROXY_AUTH_TOKEN) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── Route ───────────────────────────────────────────────────────────
        if (url.pathname !== '/proxy') {
            return new Response(JSON.stringify({ error: 'Not Found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method Not Allowed — use POST' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── Parse request body ──────────────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { url: targetUrl, headers: reqHeaders = {}, method = 'GET' } = body;

        if (!targetUrl || typeof targetUrl !== 'string') {
            return new Response(JSON.stringify({ error: 'Missing or invalid "url" field' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── Allowlist check ─────────────────────────────────────────────────
        let targetHostname;
        try {
            targetHostname = new URL(targetUrl).hostname.toLowerCase();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!ALLOWED_HOSTS.has(targetHostname)) {
            return new Response(
                JSON.stringify({ error: `Host not in allowlist: ${targetHostname}` }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // ── Build upstream request headers ──────────────────────────────────
        const forwardHeaders = new Headers();
        for (const [k, v] of Object.entries(reqHeaders)) {
            if (!HOP_BY_HOP.has(k.toLowerCase())) {
                forwardHeaders.set(k, String(v));
            }
        }
        // Default UA — make the request look like a real browser to the file host
        if (!forwardHeaders.has('User-Agent')) {
            forwardHeaders.set(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
            );
        }

        // ── Fetch through Cloudflare egress IPs ─────────────────────────────
        let upstream;
        try {
            upstream = await fetch(targetUrl, {
                method: method.toUpperCase(),
                headers: forwardHeaders,
                redirect: 'follow',
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ error: 'Upstream fetch failed', message: err.message }),
                { status: 502, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // ── Read body with size guard ────────────────────────────────────────
        const reader = upstream.body?.getReader();
        const chunks = [];
        let totalBytes = 0;
        let truncated = false;

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalBytes += value.byteLength;
                if (totalBytes > MAX_BODY_BYTES) {
                    truncated = true;
                    await reader.cancel();
                    break;
                }
                chunks.push(value);
            }
        }

        const responseBody = new Uint8Array(totalBytes > MAX_BODY_BYTES
            ? chunks.reduce((acc, c) => acc + c.byteLength, 0)
            : totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
            responseBody.set(chunk, offset);
            offset += chunk.byteLength;
        }

        // ── Build response headers ───────────────────────────────────────────
        const responseHeaders = new Headers();
        for (const [k, v] of upstream.headers.entries()) {
            if (!HOP_BY_HOP.has(k.toLowerCase())) {
                responseHeaders.set(k, v);
            }
        }
        responseHeaders.set('X-Proxy-Host', targetHostname);
        responseHeaders.set('X-Proxy-Status', String(upstream.status));
        if (truncated) {
            responseHeaders.set('X-Proxy-Truncated', 'true');
        }

        return new Response(responseBody, {
            status: upstream.status,
            headers: responseHeaders,
        });
    },
};

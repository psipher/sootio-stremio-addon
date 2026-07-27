/**
 * HTTP request utilities for HTTP streams
 * Handles HTTP/HTTPS requests with retry logic and domain caching
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import debridProxyManager from '../../util/debrid-proxy.js';
import { Impit } from 'impit';

// Configuration
const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
const DOMAIN_CACHE_TTL_MS = parseInt(process.env.DOMAIN_CACHE_TTL_MS, 10) || 15 * 60 * 1000;
const DEFAULT_MAX_BODY_SIZE = parseInt(process.env.HTTP_RESPONSE_MAX_BYTES || '2097152', 10); // 2MB default
let cachedDomains = null;
let domainCacheTimestamp = null;

// ── Cloudflare Worker Fetch Proxy ──────────────────────────────────────────
// Routes requests to CF-WAF-blocked hosts through a CF Worker (CF egress IPs),
// bypassing Cloudflare IP-reputation blocks on Vercel serverless ranges.
// Set CF_PROXY_URL + CF_PROXY_TOKEN env vars to enable (see cf-proxy/).
export const CF_PROXY_URL = process.env.CF_PROXY_URL || '';
export const CF_PROXY_TOKEN = process.env.CF_PROXY_TOKEN || '';
export const BYPARR_URL = process.env.BYPARR_URL || '';
export const BYPARR_AUTH_TOKEN = process.env.BYPARR_AUTH_TOKEN || '';
export const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';

// Proxy host allowlist — verified via live proxy test 2026-07-27:
//   hubcloud.foo              → ❌ CF Managed JS Challenge even through CF Worker (needs browser)
//   cloud.unblockedgames.world→ ✅ HTTP 200 bypassed
//   leechpro.blog             → ✅ HTTP 200 bypassed
//   links.modpro.blog         → ✅ HTTP 200 bypassed
// hubcloud.foo is intentionally excluded — keep in DEAD_HUBCLOUD_DOMAINS instead.
export const CF_PROXY_HOSTS = new Set([
    'cloud.unblockedgames.world',
    'creativeexpressionsblog.com',
    'examzculture.com',
    'leechpro.blog',
    'links.modpro.blog',
]);

/**
 * Solves a URL using Byparr or FlareSolverr browser solver.
 * Returns response body string or null if unconfigured/failed.
 *
 * @param {string} targetUrl - URL to solve via Byparr/FlareSolverr
 * @param {Object} [options={}] - Extra parameters
 * @returns {Promise<{statusCode: number, body: string, headers: Object, cookies: Array}|null>}
 */
export async function solveWithByparr(targetUrl, options = {}) {
    const solverUrl = process.env.BYPARR_URL || process.env.FLARESOLVERR_URL || BYPARR_URL || FLARESOLVERR_URL;
    const authToken = process.env.BYPARR_AUTH_TOKEN || BYPARR_AUTH_TOKEN;
    if (!solverUrl) return null;

    const endpoint = solverUrl.endsWith('/v1') ? solverUrl : `${solverUrl.replace(/\/$/, '')}/v1`;
    console.log(`[BYPARR-SOLVER] Requesting solve for: ${targetUrl} via ${endpoint}`);

    const payload = {
        cmd: 'request.get',
        url: targetUrl,
        maxTimeout: options.timeout || 60000
    };

    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
        headers['X-Auth-Token'] = authToken;
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(options.timeout || 65000)
        });

        if (!res.ok) {
            console.log(`[BYPARR-SOLVER] HTTP error ${res.status} from solver`);
            return null;
        }

        const data = await res.json();
        if (data.status === 'ok' && data.solution) {
            console.log(`[BYPARR-SOLVER] Successfully solved ${targetUrl} (Status: ${data.solution.status})`);
            return {
                statusCode: data.solution.status || 200,
                body: data.solution.response || '',
                headers: data.solution.headers || {},
                cookies: data.solution.cookies || []
            };
        }
        console.log(`[BYPARR-SOLVER] Solver response status: ${data.status} - ${data.message || ''}`);
        return null;
    } catch (err) {
        console.log(`[BYPARR-SOLVER] Error solving ${targetUrl}: ${err.message}`);
        return null;
    }
}

/**
 * Make a request through the Cloudflare Worker fetch proxy.
 * The Worker runs on CF egress IPs, bypassing CF WAF blocks on Vercel IPs.
 *
 * Returns null (not throws) when the proxy is not configured — callers should
 * fall back to makeRequest / makeImpitRequest in that case.
 *
 * @param {string} url - Target URL to fetch via CF Worker proxy
 * @param {Object} [options={}]
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object} [options.headers={}] - Request headers forwarded to target
 * @param {boolean} [options.parseHTML=false] - Parse response body with cheerio
 * @returns {Promise<{statusCode, headers, body, document, url}|null>}
 */
export async function makeCfProxyRequest(url, options = {}) {
    if (!CF_PROXY_URL || !CF_PROXY_TOKEN) return null;
    try {
        console.log(`[CF-PROXY] Routing through CF Worker proxy: ${url}`);
        const res = await fetch(CF_PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Proxy-Token': CF_PROXY_TOKEN,
            },
            body: JSON.stringify({
                url,
                method: options.method || 'GET',
                headers: options.headers || {},
            }),
        });
        const body = await res.text();
        const upstreamStatus = parseInt(res.headers.get('X-Proxy-Status') || String(res.status), 10);
        console.log(`[CF-PROXY] Response: HTTP ${upstreamStatus} for ${url}`);
        return {
            statusCode: upstreamStatus,
            headers: Object.fromEntries(res.headers.entries()),
            body,
            document: options.parseHTML ? cheerio.load(body) : null,
            url,
        };
    } catch (err) {
        console.log(`[CF-PROXY] Proxy request failed for ${url}: ${err.message}`);
        return null; // caller falls back to direct extraction
    }
}

// Impit instance for TLS browser impersonation.
// vanillaFallback: if impersonation TLS negotiation fails, Impit retries with a plain request as a safety net.
const impitInstance = new Impit({
    browser: 'chrome',
    ignoreTlsErrors: true,
    vanillaFallback: true,
});

// Cache of proxy-specific Impit instances (keyed by proxyUrl) to avoid per-request allocation overhead.
const impitProxyInstances = new Map();

/**
 * Returns an Impit instance configured with the given proxy URL.
 * Instances are cached so the same proxy reuses the same instance.
 * @param {string|null} proxyUrl - SOCKS5/HTTP proxy URL, or null for direct
 * @returns {Impit}
 */
function getImpitInstanceForProxy(proxyUrl) {
    if (!proxyUrl) return impitInstance;
    let inst = impitProxyInstances.get(proxyUrl);
    if (!inst) {
        inst = new Impit({
            browser: 'chrome',
            ignoreTlsErrors: true,
            vanillaFallback: true,
            proxyUrl,
        });
        impitProxyInstances.set(proxyUrl, inst);
        console.log(`[IMPIT] Created new proxy-backed Impit instance for: ${proxyUrl}`);
    }
    return inst;
}

function isCloudflareChallenge(body = '', statusCode = null) {
    const lower = (body || '').toLowerCase();
    if (lower.includes('cf-mitigated') ||
        lower.includes('just a moment') ||
        lower.includes('cf_chl') ||
        lower.includes('challenge-platform') ||
        lower.includes('cf-turnstile') ||
        lower.includes('verify_turnstile') ||
        (lower.includes('security check') && lower.includes('cloudflare')) ||
        lower.includes('enable javascript and cookies to continue')) {
        return true;
    }
    if (statusCode === 403 || statusCode === 429) {
        return true;
    }
    return false;
}

/**
 * Make a browser-impersonated HTTP request using Impit (TLS Chrome fingerprint).
 * This is the primary Cloudflare bypass path when FlareSolverr is unavailable (e.g., Vercel).
 * Impit spoofs TLS fingerprints at the handshake level, bypassing WAF JS challenges
 * that fail standard Node.js http/https requests from serverless IPs.
 *
 * Key options:
 * - `proxyUrl`: Routes the Impit request through an optional SOCKS5/HTTP proxy.
 *   Uses a cached per-proxy Impit instance for efficiency.
 * - `vanillaFallback` (set at instance level): if Chrome TLS impersonation fails,
 *   Impit automatically retries with a plain request as a last resort.
 * - `allowRedirects`: Controls redirect behaviour per-request.
 * - `parseHTML`: Parses the response body with cheerio for DOM extraction.
 *
 * @param {string} url - URL to fetch
 * @param {Object} [options={}]
 * @param {number} [options.timeout=15000] - Request timeout in milliseconds
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object} [options.headers={}] - Additional request headers merged into Impit defaults
 * @param {boolean} [options.allowRedirects=true] - Follow redirects (false = manual)
 * @param {boolean} [options.parseHTML=false] - Parse response body with cheerio
 * @param {string} [options.proxyUrl] - Optional proxy URL (SOCKS5 or HTTP) for this specific request
 * @returns {Promise<{statusCode: number, headers: Object, body: string, document: CheerioAPI|null, url: string}>}
 */
export async function makeImpitRequest(url, options = {}) {
    const timeout = typeof options.timeout === 'number' ? options.timeout : 15000;
    const inst = getImpitInstanceForProxy(options.proxyUrl || null);
    try {
        console.log(`[IMPIT] TLS-impersonated request: ${url}${options.proxyUrl ? ` via proxy` : ''}`);
        const res = await inst.fetch(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout,
            redirect: options.allowRedirects === false ? 'manual' : 'follow'
        });
        const body = await res.text();
        return {
            statusCode: res.status,
            headers: Object.fromEntries(res.headers.entries()),
            body,
            document: options.parseHTML ? cheerio.load(body) : null,
            url: res.url || url
        };
    } catch (err) {
        console.log(`[IMPIT] Request failed for ${url}: ${err.message}`);
        throw err;
    }
}

/**
 * Makes an HTTP/HTTPS request with retry logic & automatic impit TLS fallback
 */
export function makeRequest(url, options = {}) {
    const DEFAULT_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 8000;
    const MAX_RETRIES = typeof options.maxRetries === 'number'
        ? options.maxRetries
        : (parseInt(process.env.REQUEST_MAX_RETRIES) || 1);
    const RETRY_DELAY = typeof options.retryDelay === 'number'
        ? options.retryDelay
        : (parseInt(process.env.REQUEST_RETRY_DELAY) || 800);
    const requestTimeout = typeof options.timeout === 'number' ? options.timeout : DEFAULT_TIMEOUT;
    const maxBodySize = typeof options.maxBodySize === 'number'
        ? options.maxBodySize
        : DEFAULT_MAX_BODY_SIZE;

    const requestOnce = () => new Promise((resolve, reject) => {
        let settled = false;
        let req = null;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            if (options.signal) {
                options.signal.removeEventListener('abort', onAbort);
            }
            fn(value);
        };

        const onAbort = () => {
            const abortError = new Error('Request aborted');
            if (req) req.destroy();
            finish(reject, abortError);
        };

        try {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const isHubDomain = (() => {
                try {
                    const hostname = urlObj.hostname.toLowerCase();
                    return hostname.includes('hubcloud') || hostname.includes('hubdrive') || hostname.includes('hubcdn');
                } catch {
                    return false;
                }
            })();
            const defaultUserAgent = isHubDomain
                ? (process.env.HUBCLOUD_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0')
                : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                timeout: requestTimeout,
                headers: {
                    'User-Agent': defaultUserAgent,
                    ...options.headers
                }
            };

            const body = options.body;
            if (body && !requestOptions.headers['Content-Length']) {
                const length = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
                requestOptions.headers['Content-Length'] = length;
            }

            const serviceName = options.serviceName || 'httpstreams';
            const shouldBypassProxy = (options.disableProxy === true && options.forceProxy !== true)
                || (options.forceProxy !== true && (() => {
                    try {
                        const hostname = new URL(url).hostname.toLowerCase();
                        return hostname.includes('hubcloud') || hostname.includes('hubdrive') || hostname.includes('hubcdn');
                    } catch {
                        return false;
                    }
                })());
            if (options.agent) {
                requestOptions.agent = options.agent;
            } else if (!shouldBypassProxy) {
                const proxyAgent = debridProxyManager.getProxyAgent(serviceName);
                if (proxyAgent) {
                    requestOptions.agent = proxyAgent;
                }
            }

            req = protocol.request(requestOptions, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
                    res.headers.location && options.allowRedirects !== false) {
                    const redirectUrl = new URL(res.headers.location, url).toString();
                    console.log(`Following redirect from ${url} to ${redirectUrl}`);
                    res.destroy();
                    finish(resolve, makeRequest(redirectUrl, options));
                    return;
                }

                const chunks = [];
                let receivedBytes = 0;
                let abortedForSize = false;

                res.on('data', chunk => {
                    if (abortedForSize || settled) return;
                    receivedBytes += chunk.length;
                    if (receivedBytes > maxBodySize) {
                        abortedForSize = true;
                        const sizeError = new Error(`Response exceeded max body size (${maxBodySize} bytes) for ${url}`);
                        res.destroy();
                        req.destroy();
                        finish(reject, sizeError);
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    if (abortedForSize || settled) return;
                    try {
                        const buffer = Buffer.concat(chunks);
                        const data = buffer.toString('utf8');
                        chunks.length = 0;
                        finish(resolve, {
                            statusCode: res.statusCode,
                            headers: res.headers,
                            body: data,
                            document: options.parseHTML ? cheerio.load(data) : null,
                            url: res.headers.location || url
                        });
                    } catch (err) {
                        finish(reject, new Error(`Failed to process response: ${err.message}`));
                    }
                });
            });

            if (options.signal) {
                if (options.signal.aborted) {
                    onAbort();
                    req.destroy();
                    return;
                }
                options.signal.addEventListener('abort', onAbort, { once: true });
            }

            req.on('error', (err) => {
                req.destroy();
                finish(reject, err);
            });

            req.on('timeout', () => {
                req.destroy();
                finish(reject, new Error(`Request timeout after ${requestTimeout}ms for ${url}`));
            });

            if (body) {
                req.write(body);
            }
            req.end();
        } catch (err) {
            finish(reject, err);
        }
    });

    return (async () => {
        let lastError;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await requestOnce();
                // Check if standard HTTP request hit a Cloudflare TLS/WAF challenge
                if (options.disableImpit !== true && isCloudflareChallenge(result.body, result.statusCode)) {
                    console.log(`[makeRequest] Cloudflare challenge detected (${result.statusCode}), retrying with Impit browser TLS impersonation...`);
                    try {
                        const impitResult = await makeImpitRequest(url, options);
                        if (!isCloudflareChallenge(impitResult.body, impitResult.statusCode)) {
                            console.log(`[makeRequest] Impit successfully bypassed Cloudflare challenge for ${url}!`);
                            return impitResult;
                        }
                    } catch (impitErr) {
                        console.log(`[makeRequest] Impit fallback failed for ${url}: ${impitErr.message}`);
                    }
                }
                return result;
            } catch (err) {
                lastError = err;
                if (attempt < MAX_RETRIES) {
                    console.log(`Request attempt ${attempt + 1} failed for ${url}, retrying in ${RETRY_DELAY}ms... Error: ${err.message}`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                    continue;
                }
            }
        }
        throw lastError;
    })();
}

/**
 * Fetches and caches domain configuration
 * @returns {Promise<Object|null>} Domain configuration object
 */
export function getDomains() {
    // PERFORMANCE FIX: Check if cached domains are still valid (within TTL)
    const now = Date.now();
    if (cachedDomains && domainCacheTimestamp && (now - domainCacheTimestamp < DOMAIN_CACHE_TTL_MS)) {
        console.log(`[4KHDHub] Using cached domains (age: ${Math.floor((now - domainCacheTimestamp) / 1000)}s)`);
        return Promise.resolve(cachedDomains);
    }

    console.log(`[4KHDHub] Fetching fresh domains from ${DOMAINS_URL}`);
    return makeRequest(DOMAINS_URL)
        .then(response => {
            cachedDomains = JSON.parse(response.body);
            domainCacheTimestamp = Date.now();
            console.log(`[4KHDHub] Domains cached successfully`);
            return cachedDomains;
        })
        .catch(error => {
            console.error('Failed to fetch domains:', error.message);
            // Return stale cache if available, otherwise null
            if (cachedDomains) {
                console.log(`[4KHDHub] Using stale cached domains due to fetch error`);
                return cachedDomains;
            }
            return null;
        });
}

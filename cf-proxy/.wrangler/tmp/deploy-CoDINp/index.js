// src/index.js
var ALLOWED_HOSTS = /* @__PURE__ */ new Set([
  "cloud.unblockedgames.world",
  "leechpro.blog",
  "links.modpro.blog"
]);
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "x-proxy-token"
  // our auth header — must not leak to target
]);
var MAX_BODY_BYTES = 10 * 1024 * 1024;
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    const token = request.headers.get("X-Proxy-Token");
    if (!env.PROXY_AUTH_TOKEN || token !== env.PROXY_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname !== "/proxy") {
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed \u2014 use POST" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const { url: targetUrl, headers: reqHeaders = {}, method = "GET" } = body;
    if (!targetUrl || typeof targetUrl !== "string") {
      return new Response(JSON.stringify({ error: 'Missing or invalid "url" field' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    let targetHostname;
    try {
      targetHostname = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid target URL" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!ALLOWED_HOSTS.has(targetHostname)) {
      return new Response(
        JSON.stringify({ error: `Host not in allowlist: ${targetHostname}` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    const forwardHeaders = new Headers();
    for (const [k, v] of Object.entries(reqHeaders)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) {
        forwardHeaders.set(k, String(v));
      }
    }
    if (!forwardHeaders.has("User-Agent")) {
      forwardHeaders.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
      );
    }
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: method.toUpperCase(),
        headers: forwardHeaders,
        redirect: "follow"
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Upstream fetch failed", message: err.message }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
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
    const responseBody = new Uint8Array(totalBytes > MAX_BODY_BYTES ? chunks.reduce((acc, c) => acc + c.byteLength, 0) : totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      responseBody.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const responseHeaders = new Headers();
    for (const [k, v] of upstream.headers.entries()) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) {
        responseHeaders.set(k, v);
      }
    }
    responseHeaders.set("X-Proxy-Host", targetHostname);
    responseHeaders.set("X-Proxy-Status", String(upstream.status));
    if (truncated) {
      responseHeaders.set("X-Proxy-Truncated", "true");
    }
    return new Response(responseBody, {
      status: upstream.status,
      headers: responseHeaders
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sootio is a Stremio addon that aggregates streaming links from multiple sources:
- **7 Debrid providers**: Real-Debrid, All-Debrid, TorBox, Premiumize, OffCloud, Debrid-Link, Debrider.app
- **14+ torrent scrapers**: Jackett, Zilean, 1337x, BTDigg, MagnetDL, Torrentio, Comet, etc.
- **HTTP streaming providers**: 4KHDHub, UHDMovies, MKVDrama, NetflixMirror, etc.
- **Usenet support**: Newznab indexers + SABnzbd with progressive streaming

Built with Node.js 20, ESM modules, Express, and the Stremio Addon SDK.

## Common Commands

```bash
# Install dependencies (pnpm required)
pnpm install

# Production with multi-worker clustering
npm start                    # or: npm run start

# Development with auto-reload
npm run dev

# Single worker mode (debugging)
npm run standalone          # or: npm run standalone:dev for debug logs

# Run tests
npm test

# Run single test file
node --max-old-space-size=2048 --expose-gc node_modules/.bin/jest tests/mkvdrama.test.js

# Docker
docker-compose up -d --build
docker-compose logs -f
```

## Architecture

### Entry Points
- `server.js` - Express server, route handlers, Stremio SDK integration (~1400 lines)
- `cluster.js` - Multi-worker process management with crash loop protection
- `addon.js` - Stremio addon builder, catalog and stream handlers

### Core Flow
1. **Request** → `addon.js` defineStreamHandler
2. **Orchestration** → `lib/stream-provider.js` coordinates all sources in parallel
3. **Scraping** → `lib/scrapers/` fetches torrent metadata from enabled sources
4. **Cache Check** → `lib/common/debrid-cache-processor.js` checks debrid availability
5. **Formatting** → `lib/stream-provider/formatters/` formats streams for Stremio

### Key Directories
```
lib/
├── scrapers/              # Torrent scrapers by category
│   ├── public-trackers/   # 1337x, btdig, magnetdl, etc.
│   ├── torznab/           # Jackett, Zilean, Bitmagnet
│   ├── stremio-addons/    # Torrentio, Comet, StremThru bridges
│   └── specialized/       # Wolfmax4K, BluDV, Snowfl
├── http-streams/          # HTTP streaming providers
│   ├── providers/         # 4khdhub, mkvdrama, netflixmirror, etc.
│   ├── resolvers/         # Link resolution (hubcloud, pixeldrain, etc.)
│   └── utils/             # HTTP helpers, parsing, validation
├── util/                  # Shared utilities
│   ├── cache-store.js     # SQLite cache backend selector
│   ├── postgres-cache.js  # Postgres cache for multi-instance
│   ├── rd-rate-limit.js   # Real-Debrid rate limiter
│   ├── ad-rate-limit.js   # All-Debrid rate limiter
│   ├── proxy-manager.js   # SOCKS5/HTTP proxy handling
│   └── cinemeta.js        # IMDB metadata fetching
├── stream-provider/       # Stream orchestration modules
│   ├── caching/           # Background refresh, deduplication
│   ├── formatters/        # Stream name/description formatting
│   └── utils/             # Filtering, sorting utilities
└── [provider].js          # Debrid provider implementations
cf-proxy/                  # Cloudflare Worker fetch proxy (see below)
├── wrangler.toml
└── src/index.js
```

### Debrid Provider Pattern
Each debrid provider (`lib/real-debrid.js`, `lib/all-debrid.js`, etc.) implements:
- `checkCachedTorrents(apiKey, magnets)` - Check cache availability
- `getDownloadUrl(apiKey, magnet, fileIdx)` - Get streaming URL
- Personal cloud/downloads listing

### Adding a New Scraper
1. Create file in `lib/scrapers/[category]/` following existing patterns
2. Export `scrapeTorrents(imdbId, type, title, year, season, episode)` function
3. Register in `lib/scrapers/index.js`
4. Add env vars in `.env.example` with `[NAME]_ENABLED`, `[NAME]_URL`, etc.

### Adding a New HTTP Stream Provider
1. Create directory in `lib/http-streams/providers/[name]/`
2. Implement `search.js` and `streams.js`
3. Register in `lib/http-streams.js` exports
4. Add to `lib/stream-provider.js` HTTP streaming section

## Configuration

All config via `.env` file. Key patterns:
- `[SCRAPER]_ENABLED=true/false` - Enable/disable scrapers
- `[SCRAPER]_URL` - Base URL for scraper
- `[SCRAPER]_LIMIT` - Max results per search
- `RD_*`, `AD_*` - Rate limits for debrid providers
- `DEBRID_HTTP_PROXY` - SOCKS5/HTTP proxy URL
- `CF_PROXY_URL` - Cloudflare Worker fetch proxy URL for bypassing CF WAF blocks
- `CF_PROXY_TOKEN` - Authentication token matching Cloudflare Worker PROXY_AUTH_TOKEN secret
- `BYPARR_URL` - Byparr Camoufox anti-bot solver service URL (Cloud Run)
- `SQLITE_CACHE_ENABLED=true` - Enable persistent cache
- `CACHE_BACKEND=sqlite|postgres` - Cache backend selection

## Testing

Tests are in `tests/` using Jest. Most tests are integration tests that hit external APIs.

```bash
# Run all tests
npm test

# Run specific test
npm test -- tests/mkvdrama.test.js

# Run with verbose output
npm test -- --verbose
```

## Important Patterns

### Rate Limiting
Debrid APIs have strict rate limits. Use the rate limiters in `lib/util/rd-rate-limit.js` and `lib/util/ad-rate-limit.js`.

### Proxy Support
Proxy configuration flows through `lib/util/proxy-manager.js`. Per-service proxies can be configured via `DEBRID_PER_SERVICE_PROXIES`.

### Caching Layers
1. **In-memory** - NodeCache for hot data (5000 entries)
2. **SQLite** - Persistent cache (`data/` directory)
3. **Postgres** - Optional shared cache for multi-instance deployments

### ESM Modules
This project uses ES modules (`"type": "module"` in package.json). Use `import`/`export` syntax, not `require()`.

---

## Vercel Deployment & Anti-Bot Infrastructure

### Current Production URL
`https://sootio-stremio-addon-wmc4.vercel.app`

### 🌐 CF Worker Proxy (`cf-proxy/`)
A stateless Cloudflare Worker deployed at `https://sootio-fetch-proxy.reclassified.workers.dev`.
- Routes extraction requests through Cloudflare's own egress IPs, bypassing IP-reputation WAF blocks.

### 🛡️ Byparr Anti-Bot Solver (Google Cloud Run)
Deployed on Google Cloud Run (`https://byparr-765408203668.us-central1.run.app`, $0.00 Always Free Tier).
- Uses **Camoufox** (patched C++ anti-detection Firefox) to solve Cloudflare Turnstile and JS challenges.
- Modern, drop-in replacement for FlareSolverr.

**Required Vercel env vars** (set in Vercel Dashboard → Project Settings → Environment Variables):
```env
CF_PROXY_URL=https://sootio-fetch-proxy.reclassified.workers.dev/proxy
CF_PROXY_TOKEN=<sensitive-proxy-secret>
BYPARR_URL=https://byparr-765408203668.us-central1.run.app
BYPARR_AUTH_TOKEN=<sensitive-byparr-secret>
```

**Live proxy test results (2026-07-27)**:

| Host | Proxy Result | Action |
|------|-------------|--------|
| `cloud.unblockedgames.world` | ✅ HTTP 200 | In `CF_PROXY_HOSTS`, proxied |
| `leechpro.blog` | ✅ HTTP 200 | In `CF_PROXY_HOSTS`, proxied |
| `links.modpro.blog` | ✅ HTTP 200 | In `CF_PROXY_HOSTS`, proxied |
| `hubcloud.foo` | ❌ CF Managed JS Challenge | In `DEAD_HUBCLOUD_DOMAINS`, permanent fast-fail |

### Vercel Fast-Fail Logic (`lib/http-streams/resolvers/http-resolver.js`)
- `IS_VERCEL_SERVERLESS`: detected via `process.env.VERCEL === '1'` or `VERCEL_ENV`.
- `VERCEL_BLOCKED_DOMAINS`: Set containing only `hubcloud.foo` (fast-fails in ~80ms).
- Skips HTTP 206 range-request validation on Vercel (those requests are also IP-blocked).

### Known Limitations on Vercel (Free Tier)
- `hubcloud.foo` (MoviesDrive search-recover) uses CF **Managed JS Challenge** — requires a real browser with JS execution. Cannot be bypassed by any `fetch()`-based proxy. These streams will never work on serverless.
- `hubcloud.ist` and `hubdrive.tips` work because they use workers.dev CDN (not CF WAF).

---

## HTTP Streaming Diagnostics & Tests

### E2E Stream Test (primary validation)
Tests redirect chain, MIME type, and HTTP 206 seekability for top streams:
```bash
node tests/e2e-stream-test.js
```
Expected results: streams from `hubcloud.ist`, `hubdrive.tips`, `cinedoze.tv` should return HTTP 206 `video/x-matroska`.

### Proxy Domain Test (run when checking CF proxy bypass for new hosts)
```bash
# Write a quick test script or adapt diag-all-providers pattern:
node -e "
const token = process.env.CF_PROXY_TOKEN;
const url = 'https://sootio-fetch-proxy.reclassified.workers.dev/proxy';
fetch(url, { method:'POST', headers:{'Content-Type':'application/json','X-Proxy-Token':token}, body: JSON.stringify({url:'https://leechpro.blog/archives/22987',method:'GET'}) })
  .then(r => r.text()).then(b => console.log('Status:', r.status, 'CF:', b.includes('cf_chl')));
" 2>&1
```

### CF Worker Health Check
```bash
curl https://sootio-fetch-proxy.reclassified.workers.dev/health
# Expected: {"ok":true,"ts":<epoch>}
```

### Re-deploying the CF Worker (after changes to `cf-proxy/src/index.js`)
```bash
cd cf-proxy
npx wrangler deploy
# Secret is already set — no need to re-run `secret put` unless rotating the token
```

---

## Next Steps / Remaining Work

1. **Set Vercel env vars** (if not already done):
   - `CF_PROXY_URL=https://sootio-fetch-proxy.reclassified.workers.dev/proxy`
   - `CF_PROXY_TOKEN=<your-secret-matching-workers-PROXY_AUTH_TOKEN>`
   - After setting, trigger a Vercel redeploy (or `git push`).

2. **Validate with E2E test** after Vercel redeploy:
   ```bash
   node tests/e2e-stream-test.js
   ```
   - Previously: 3/5 streams resolved → After proxy: expect `leechpro`/`modpro`/`unblockedgames` streams to also resolve.

3. **`hubcloud.foo` (MoviesDrive) — Long-term options**:
   - Option A: Self-host the addon on a VPS and use FlareSolverr (already supported via `FLARESOLVERR_URL` env var).
   - Option B: Use Puppeteer/browserless.io remote browser service for `hubcloud.foo` specifically.
   - Option C: Accept it as a known limitation on serverless and disable MoviesDrive provider on Vercel.

4. **Add remaining providers to `CF_PROXY_HOSTS`** if new blocked hosts are discovered:
   - Edit `lib/http-streams/utils/http.js` → `CF_PROXY_HOSTS`
   - Edit `cf-proxy/src/index.js` → `ALLOWED_HOSTS`
   - Run proxy test to verify bypass works before shipping
   - Redeploy Worker: `cd cf-proxy && npx wrangler deploy`

5. **Monitor CF Worker usage** in Cloudflare Dashboard → Workers → sootio-fetch-proxy → Analytics.
   - Free tier: 100,000 requests/day. If exceeded, upgrade to Paid ($5/mo, 10M requests/mo).


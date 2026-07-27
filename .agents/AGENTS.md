# Workspace Agent Rules

## Domain Audit & Auto-Update Protocol 🚨
1. **Domain Failure Detection**: Whenever any provider scraper or resolver fails with `ENOTFOUND`, `404`, or a domain redirect during execution or testing:
   - Run `npm run check-domains` (`node scripts/check-all-provider-domains.mjs`) to audit all provider base domains, intermediate gateways, and file hosters.
2. **Auto-Update Domain**:
   - If a domain is **redirected** (e.g. `hubcloud.ist` -> `hubcloud.cx`, `moviesmod.town` -> `moviesmod.at`), immediately update the hardcoded fallback domains in `lib/http-streams/` and `DomainManager`.
   - If a domain returns `ENOTFOUND` (DNS dead), find the active working domain and update the provider configuration.

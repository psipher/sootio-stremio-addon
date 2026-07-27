/**
 * Centralized Dynamic Self-Healing Domain Manager
 * Fetches domains from TVVVV remote JSON, follows HTTP 301/302 redirects,
 * performs HTML health verification, and caches verified working base URLs.
 */

import { makeRequest } from '../http-streams/utils/http.js';

const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
const DOMAIN_CACHE_TTL = parseInt(process.env.DOMAIN_CACHE_TTL_MS, 10) || 15 * 60 * 1000; // 15 mins default

// Fallback static domains if TVVVV is unreachable
const STATIC_FALLBACK_DOMAINS = {
    moviesmod: 'https://moviesmod.at',
    UHDMovies: 'https://uhdmovies.casa',
    HDHUB4u: 'https://new3.hdhub4u.cl',
    '4khdhub': 'https://4khdhub.one',
    moviesdrive: 'https://moviesdrives.cv',
    topMovies: 'https://moviesleech.asia',
    cinedoze: 'https://cinedoze.tv',
    MKVCinemas: 'https://mkvcinemas.org',
    mallumv: 'https://mallumv.wiki',
    xdmovies: 'https://top.xdmovies.wtf'
};

const domainCache = new Map(); // providerKey -> { domain: string, timestamp: number }
let tvvvvCache = null;
let tvvvvTimestamp = 0;

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
 * Fetch remote TVVVV domains dictionary
 */
async function fetchRemoteTVVVVDomains() {
    const now = Date.now();
    if (tvvvvCache && (now - tvvvvTimestamp < DOMAIN_CACHE_TTL)) {
        return tvvvvCache;
    }

    try {
        console.log(`[DomainManager] Fetching domains JSON from ${DOMAINS_URL}`);
        const response = await makeRequest(DOMAINS_URL, { timeout: 8000, disableImpit: true });
        if (response?.body) {
            tvvvvCache = JSON.parse(response.body);
            tvvvvTimestamp = now;
            console.log(`[DomainManager] TVVVV domains fetched successfully`);
            return tvvvvCache;
        }
    } catch (err) {
        console.warn(`[DomainManager] Failed to fetch remote TVVVV domains: ${err.message}`);
    }
    return tvvvvCache || STATIC_FALLBACK_DOMAINS;
}

/**
 * Resolves final canonical domain by following redirects and verifying HTML health
 */
async function resolveAndVerifyDomain(initialUrl, providerKey) {
    if (!initialUrl) return null;

    try {
        const res = await makeRequest(initialUrl, { parseHTML: true, timeout: 8000, allowRedirects: true });
        if (res && res.statusCode === 200 && !isCloudflareChallenge(res.body, res.statusCode)) {
            let finalUrl = res.url || initialUrl;

            // Check if page is a gateway landing page containing embedded destination URLs (e.g. Base64 encoded)
            if (res.body && (res.body.includes('Explore Movies') || res.body.includes('checkHost') || res.body.includes('aHR0cHM6'))) {
                const b64Matches = res.body.match(/aHR0cHM6[A-Za-z0-9+/=]+/g) || [];
                for (const b64 of b64Matches) {
                    try {
                        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
                        if (decoded.startsWith('http') && !decoded.includes('cdn.') && !decoded.includes('mdrivecdn')) {
                            console.log(`[DomainManager] Extracted landing page destination for "${providerKey}": ${decoded}`);
                            const targetRes = await makeRequest(decoded, { parseHTML: true, timeout: 8000, allowRedirects: true });
                            if (targetRes && targetRes.statusCode === 200 && !isCloudflareChallenge(targetRes.body, targetRes.statusCode)) {
                                finalUrl = targetRes.url || decoded;
                                break;
                            }
                        }
                    } catch {}
                }
            }

            const parsed = new URL(finalUrl);
            if (parsed.hostname.includes('filmyfly') || finalUrl.includes('suspendedpage')) {
                console.warn(`[DomainManager] Rejecting hijacked/parked domain for "${providerKey}": ${finalUrl}`);
                return null;
            }
            const canonicalDomain = `${parsed.protocol}//${parsed.host}`;
            console.log(`[DomainManager] Verified domain for "${providerKey}": ${canonicalDomain} (initial: ${initialUrl})`);
            return canonicalDomain;
        } else {
            console.warn(`[DomainManager] Health check failed for ${initialUrl} (status: ${res?.statusCode})`);
        }
    } catch (err) {
        console.warn(`[DomainManager] Failed to resolve/verify domain ${initialUrl}: ${err.message}`);
    }

    return null;
}

/**
 * Get verified working base domain for a provider
 * @param {string} providerKey - Key in TVVVV (e.g. 'moviesmod', 'UHDMovies', 'HDHUB4u', '4khdhub', 'moviesdrive')
 * @param {string} [fallbackUrl] - Fallback domain if key not found
 */
export async function getProviderDomain(providerKey, fallbackUrl = '') {
    const now = Date.now();
    const cached = domainCache.get(providerKey);
    if (cached && (now - cached.timestamp < DOMAIN_CACHE_TTL)) {
        return cached.domain;
    }

    const defaultFallback = fallbackUrl || STATIC_FALLBACK_DOMAINS[providerKey] || '';
    const tvvvv = await fetchRemoteTVVVVDomains();
    const rawUrl = tvvvv?.[providerKey] || defaultFallback;

    let verifiedDomain = await resolveAndVerifyDomain(rawUrl, providerKey);

    // If TVVVV domain failed health check (e.g. 403 or 404), test static fallback domain
    if (!verifiedDomain && defaultFallback && defaultFallback !== rawUrl) {
        console.log(`[DomainManager] TVVVV domain for "${providerKey}" failed health check, testing static fallback: ${defaultFallback}`);
        verifiedDomain = await resolveAndVerifyDomain(defaultFallback, providerKey);
    }

    const finalDomain = verifiedDomain || defaultFallback || rawUrl;
    domainCache.set(providerKey, { domain: finalDomain, timestamp: now });
    return finalDomain;
}

/**
 * Invalidate cached domain for a provider (useful when a provider encounters runtime errors)
 */
export function invalidateProviderDomain(providerKey) {
    console.log(`[DomainManager] Invalidating cached domain for "${providerKey}"`);
    domainCache.delete(providerKey);
}

export default {
    getProviderDomain,
    invalidateProviderDomain,
    fetchRemoteTVVVVDomains
};

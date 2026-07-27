/**
 * Test OUO link resolution to pixeldrain
 */

import { config } from 'dotenv';
config();

import axios from 'axios';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';
const FLARESOLVERR_PROXY_URL = process.env.FLARESOLVERR_PROXY_URL || '';
const OUO_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchWithFlareSolverr(url, options = {}) {
    if (!FLARESOLVERR_URL) {
        console.log('No FLARESOLVERR_URL configured - skipping live FlareSolverr call');
        return { body: null, url: null, status: null };
    }
    const requestBody = {
        cmd: options.method === 'POST' ? 'request.post' : 'request.get',
        url,
        maxTimeout: 60000
    };
    if (FLARESOLVERR_PROXY_URL) {
        requestBody.proxy = { url: FLARESOLVERR_PROXY_URL };
    }
    if (options.postData) {
        requestBody.postData = options.postData;
    }
    const response = await axios.post(`${FLARESOLVERR_URL}/v1`, requestBody, {
        timeout: 65000,
        headers: { 'Content-Type': 'application/json' }
    });
    const solution = response?.data?.solution;
    return {
        body: solution?.response || null,
        url: solution?.url || null,
        status: solution?.status || null
    };
}

function extractRedirectCandidates(body, baseUrl) {
    const candidates = [];

    // JavaScript location redirects
    const scriptMatches = body.match(/location\.(?:href|replace|assign)\s*(?:\(\s*)?['"]([^'"]+)['"]\s*\)?/gi) || [];
    scriptMatches.forEach(match => {
        const urlMatch = match.match(/['"]([^'"]+)['"]/);
        if (urlMatch?.[1]) {
            try {
                candidates.push(new URL(urlMatch[1], baseUrl).toString());
            } catch {}
        }
    });

    // Meta refresh
    const refreshMatch = body.match(/http-equiv=['""]refresh['""][^>]*content=['"][\d;]*url=([^'"]+)['"]/i);
    if (refreshMatch?.[1]) {
        try {
            candidates.push(new URL(refreshMatch[1].trim(), baseUrl).toString());
        } catch {}
    }

    // All URLs in the page
    const urlMatches = body.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    urlMatches.forEach(url => {
        if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('oii.la')) {
            candidates.push(url);
        }
    });

    return candidates;
}

function pickViewcrateOrPixeldrain(candidates) {
    // Prefer pixeldrain
    const pixeldrain = candidates.find(c => c.includes('pixeldrain'));
    if (pixeldrain) return pixeldrain;

    // Then viewcrate
    const viewcrate = candidates.find(c => c.includes('viewcrate'));
    if (viewcrate) return viewcrate;

    // Then any external link
    return candidates.find(c =>
        !c.includes('ouo.io') &&
        !c.includes('ouo.press') &&
        !c.includes('oii.la') &&
        !c.includes('.js') &&
        !c.includes('.css') &&
        !c.includes('.png') &&
        !c.includes('.ico')
    ) || null;
}

async function resolveOuoLink(shortUrl) {
    console.log(`\n=== Resolving OUO Link: ${shortUrl} ===\n`);

    let currentUrl = shortUrl;
    const maxSteps = 5;

    for (let step = 0; step < maxSteps; step++) {
        console.log(`Step ${step + 1}: Fetching ${currentUrl}`);

        const response = await fetchWithFlareSolverr(currentUrl);
        if (!response.body) {
            console.log('  No response body');
            return null;
        }

        console.log(`  Response URL: ${response.url}`);
        console.log(`  Status: ${response.status}`);
        console.log(`  Body length: ${response.body.length}`);

        // Check if we've been redirected to a non-OUO URL
        if (response.url &&
            !response.url.includes('ouo.io') &&
            !response.url.includes('ouo.press') &&
            !response.url.includes('oii.la')) {
            console.log(`  ✓ Redirected to: ${response.url}`);
            return response.url;
        }

        // Look for redirect candidates in the page
        const candidates = extractRedirectCandidates(response.body, currentUrl);
        console.log(`  Found ${candidates.length} URL candidates`);

        // Check for viewcrate or pixeldrain
        const target = pickViewcrateOrPixeldrain(candidates);
        if (target) {
            console.log(`  ✓ Found target: ${target.substring(0, 80)}...`);
            return target;
        }

        // Check if there's a form to submit
        const formMatch = response.body.match(/<form[^>]*action=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/form>/i);
        if (formMatch) {
            console.log('  Found form, extracting fields...');
            const action = formMatch[1];
            const formHtml = formMatch[2];

            // Extract input fields
            const inputs = {};
            const inputPattern = /<input[^>]*name=['"]([^'"]+)['"][^>]*(?:value=['"]([^'"]*)['""])?/gi;
            let inputMatch;
            while ((inputMatch = inputPattern.exec(formHtml)) !== null) {
                inputs[inputMatch[1]] = inputMatch[2] || '';
            }

            console.log(`  Form action: ${action}`);
            console.log(`  Form fields: ${Object.keys(inputs).join(', ')}`);

            // Try to resolve the action URL
            try {
                const actionUrl = new URL(action, currentUrl).toString();
                currentUrl = actionUrl;
                continue;
            } catch {}
        }

        // Check for go/ path
        const goMatch = response.body.match(/\/go\/[A-Za-z0-9]+/);
        if (goMatch) {
            try {
                currentUrl = new URL(goMatch[0], currentUrl).toString();
                console.log(`  Found /go/ path: ${currentUrl}`);
                continue;
            } catch {}
        }

        console.log('  No redirect found');
        break;
    }

    return null;
}

async function testResolve() {
    console.log('=== Testing OUO Link Resolution ===\n');
    console.log(`FlareSolverr: ${FLARESOLVERR_URL}`);
    console.log(`Proxy: ${FLARESOLVERR_PROXY_URL}\n`);

    // Test with one of the links from The Judge Returns
    const testLinks = [
        'https://ouo.io/XcDSmC',  // 540p
        'https://ouo.io/ujJQPI',  // 720p
    ];

    for (const link of testLinks.slice(0, 1)) {
        const result = await resolveOuoLink(link);
        if (result) {
            console.log(`\n=== FINAL RESULT ===`);
            console.log(`Input: ${link}`);
            console.log(`Output: ${result}`);

            if (result.includes('viewcrate')) {
                console.log('\n✓ Resolved to ViewCrate - this will be further resolved to Pixeldrain');
            } else if (result.includes('pixeldrain')) {
                console.log('\n✓ Resolved directly to Pixeldrain!');
            } else {
                console.log(`\n? Resolved to: ${result}`);
            }
        } else {
            console.log(`\n✗ Failed to resolve ${link}`);
        }
    }
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama Resolve', () => {
        test('should test OUO link resolution', async () => {
            await testResolve();
        }, 60000);
    });
} else {
    testResolve().catch(console.error);
}

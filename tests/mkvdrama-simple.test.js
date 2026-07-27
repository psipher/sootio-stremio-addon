/**
 * Simple MKVDrama test using axios directly
 * Tests against the live mkvdrama.net site using FlareSolverr
 */

import { config } from 'dotenv';
config();

import axios from 'axios';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';
const FLARESOLVERR_PROXY_URL = process.env.FLARESOLVERR_PROXY_URL || '';
const FLARESOLVERR_V2 = process.env.FLARESOLVERR_V2 === 'true';
const BASE_URL = 'https://mkvdrama.net';

console.log('=== MKVDrama Simple Test ===');
console.log(`FlareSolverr URL: ${FLARESOLVERR_URL}`);
console.log(`FlareSolverr Proxy: ${FLARESOLVERR_PROXY_URL}`);
console.log(`FlareSolverr V2: ${FLARESOLVERR_V2}`);

async function fetchWithFlareSolverr(url) {
    if (!FLARESOLVERR_URL) {
        console.log('No FlareSolverr URL configured');
        return null;
    }

    const requestBody = {
        cmd: 'request.get',
        url,
        maxTimeout: 60000
    };

    if (FLARESOLVERR_PROXY_URL) {
        requestBody.proxy = { url: FLARESOLVERR_PROXY_URL };
    }

    try {
        console.log(`Fetching: ${url}`);
        const response = await axios.post(`${FLARESOLVERR_URL}/v1`, requestBody, {
            timeout: 65000,
            headers: { 'Content-Type': 'application/json' }
        });

        const solution = response?.data?.solution;
        if (!solution?.response) {
            console.log('FlareSolverr returned no response');
            console.log('Status:', response?.data?.status);
            console.log('Message:', response?.data?.message);
            return null;
        }

        const body = solution.response;
        console.log(`Got response: ${body.length} bytes, status: ${solution.status}`);

        // Check for Cloudflare challenge
        const lower = body.toLowerCase();
        if (lower.includes('just a moment') || lower.includes('checking your browser')) {
            console.log('Still blocked by Cloudflare');
            return null;
        }

        return body;
    } catch (error) {
        console.error(`FlareSolverr error: ${error.message}`);
        return null;
    }
}

async function testSearch(query) {
    console.log(`\n=== Testing search for: "${query}" ===`);
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;

    const body = await fetchWithFlareSolverr(searchUrl);
    if (!body) {
        console.log('Failed to fetch search page');
        return [];
    }

    // Simple regex to find article links
    const articlePattern = /<article[^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const results = [];
    let match;

    while ((match = articlePattern.exec(body)) !== null) {
        results.push({
            url: match[1],
            title: match[2].trim()
        });
    }

    // If no articles found, try different patterns
    if (results.length === 0) {
        // Try .bsx pattern from current code
        const bsxPattern = /<div class="bsx"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>/gi;
        while ((match = bsxPattern.exec(body)) !== null) {
            results.push({
                url: match[1],
                title: match[2].trim()
            });
        }
    }

    // Try h2.entry-title pattern
    if (results.length === 0) {
        const h2Pattern = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        while ((match = h2Pattern.exec(body)) !== null) {
            results.push({
                url: match[1],
                title: match[2].trim()
            });
        }
    }

    console.log(`Found ${results.length} results`);
    results.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.title}`);
        console.log(`     ${r.url}`);
    });

    // Log page title for debugging
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    console.log(`Page title: ${titleMatch ? titleMatch[1] : 'N/A'}`);

    // Log body snippet for debugging
    console.log(`Body snippet: ${body.replace(/\s+/g, ' ').substring(0, 500)}...`);

    return results;
}

async function testLoadContent(url) {
    console.log(`\n=== Testing content load for: ${url} ===`);

    const body = await fetchWithFlareSolverr(url);
    if (!body) {
        console.log('Failed to fetch content page');
        return null;
    }

    // Extract title
    const titleMatch = body.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                       body.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|\s*MkvDrama.*$/i, '').trim() : 'Unknown';
    console.log(`Title: ${title}`);

    // Look for data-riwjd attributes (encoded links)
    const riwjdPattern = /data-riwjd="([^"]+)"/g;
    const encodedLinks = [];
    let match;
    while ((match = riwjdPattern.exec(body)) !== null) {
        encodedLinks.push(match[1]);
    }
    console.log(`Found ${encodedLinks.length} encoded links (data-riwjd)`);

    // Look for ouo.io/ouo.press links
    const ouoPattern = /https?:\/\/(ouo\.io|ouo\.press|oii\.la)\/[^\s"'<>]+/gi;
    const ouoLinks = [];
    while ((match = ouoPattern.exec(body)) !== null) {
        ouoLinks.push(match[0]);
    }
    console.log(`Found ${ouoLinks.length} ouo links`);

    // Look for pixeldrain mentions
    const pdPattern = /pixeldrain/gi;
    const pdMatches = body.match(pdPattern);
    console.log(`Found ${pdMatches?.length || 0} pixeldrain mentions`);

    // Check for specific selectors from the code
    const hasSoraddlx = body.includes('soraddlx') || body.includes('soraddl') || body.includes('soradd');
    const hasSorattlx = body.includes('sorattlx') || body.includes('sorattl') || body.includes('soratt');
    console.log(`Has soraddlx/soraddl/soradd: ${hasSoraddlx}`);
    console.log(`Has sorattlx/sorattl/soratt: ${hasSorattlx}`);

    // Check for data-oc2le (host info)
    const oc2lePattern = /data-oc2le="([^"]+)"/g;
    const hosts = [];
    while ((match = oc2lePattern.exec(body)) !== null) {
        hosts.push(match[1]);
    }
    console.log(`Found hosts (data-oc2le): ${hosts.length > 0 ? hosts.slice(0, 5).join(', ') : 'none'}`);

    // Check for data-07cgr (alternate host info)
    const cgr7Pattern = /data-07cgr="([^"]+)"/g;
    const hosts2 = [];
    while ((match = cgr7Pattern.exec(body)) !== null) {
        hosts2.push(match[1]);
    }
    console.log(`Found hosts (data-07cgr): ${hosts2.length > 0 ? hosts2.slice(0, 5).join(', ') : 'none'}`);

    // Log body snippet
    console.log(`\nBody snippet (looking for download links):`);
    const downloadSection = body.match(/class="[^"]*(?:download|soradd|soraddl)[^"]*"[\s\S]{0,2000}/i);
    if (downloadSection) {
        console.log(downloadSection[0].replace(/\s+/g, ' ').substring(0, 800));
    } else {
        console.log('No download section found');
    }

    return { title, encodedLinks, ouoLinks };
}

async function runTests() {
    // Test 1: Search
    console.log('\n=== TEST 1: Search ===');
    const results = await testSearch('Squid Game');

    // Test 2: Load content from first result
    if (results.length > 0) {
        console.log('\n=== TEST 2: Load Content ===');
        await testLoadContent(results[0].url);
    }

    // Test 3: Try direct URL
    console.log('\n=== TEST 3: Direct URL ===');
    await testLoadContent('https://mkvdrama.net/squid-game-2021/');

    console.log('\n=== Tests Complete ===');
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama Simple', () => {
        test('should run MKVDrama simple test suite', async () => {
            await runTests();
        }, 60000);
    });
} else {
    runTests().catch(console.error);
}

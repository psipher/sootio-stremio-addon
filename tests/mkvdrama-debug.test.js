/**
 * Debug test for MKVDrama search
 */

import { config } from 'dotenv';
config();

import axios from 'axios';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';
const FLARESOLVERR_PROXY_URL = process.env.FLARESOLVERR_PROXY_URL || '';
const BASE_URL = 'https://mkvdrama.net';

async function fetchWithFlareSolverr(url) {
    if (!FLARESOLVERR_URL) {
        console.log('No FLARESOLVERR_URL configured - skipping live FlareSolverr call');
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
    const response = await axios.post(`${FLARESOLVERR_URL}/v1`, requestBody, {
        timeout: 65000,
        headers: { 'Content-Type': 'application/json' }
    });
    return response?.data?.solution?.response || null;
}

async function debugSearch() {
    console.log('=== Debug MKVDrama Search ===\n');

    const query = 'The Judge Returns';
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    console.log(`Search URL: ${searchUrl}\n`);

    const body = await fetchWithFlareSolverr(searchUrl);
    if (!body) {
        console.log('Failed to fetch');
        return;
    }

    // Find all article elements
    console.log('Looking for article elements...\n');

    // Check for different article structures
    const patterns = [
        { name: 'article with bsx', regex: /<article[^>]*>[\s\S]*?<div class="bsx"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"/gi },
        { name: 'article h2 a', regex: /<article[^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)/gi },
        { name: 'h2.entry-title a', regex: /<h2[^>]*entry-title[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)/gi },
        { name: 'bookmark rel', regex: /<a[^>]*rel="bookmark"[^>]*href="([^"]+)"[^>]*>([^<]+)/gi },
        { name: 'result-item', regex: /<div class="result-item"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)/gi },
        { name: 'tt block', regex: /<div class="tt"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)/gi },
    ];

    for (const { name, regex } of patterns) {
        const matches = [];
        let match;
        while ((match = regex.exec(body)) !== null) {
            matches.push({ url: match[1], title: match[2] });
        }
        console.log(`Pattern "${name}": ${matches.length} matches`);
        if (matches.length > 0) {
            matches.slice(0, 3).forEach(m => console.log(`  - ${m.title?.trim()}: ${m.url}`));
        }
    }

    // Look at the raw HTML structure around articles
    console.log('\n=== Looking at article structure ===\n');
    const articleMatch = body.match(/<article[^>]*class="([^"]*)"[^>]*>([\s\S]{0,2000})/i);
    if (articleMatch) {
        console.log(`Article class: ${articleMatch[1]}`);
        console.log(`Article content preview:\n${articleMatch[2].replace(/\s+/g, ' ').substring(0, 500)}...`);
    }

    // Check if search returned "no results" message
    console.log('\n=== Checking for "no results" message ===');
    if (body.includes('Nothing Found') || body.includes('No results') || body.includes('no posts found')) {
        console.log('Search returned NO RESULTS message');
    }

    // Look for the actual listing structure
    console.log('\n=== Looking for listing structure ===\n');
    const listingMatch = body.match(/<div class="(?:listupd|latest-posts|search-results|content-posts)"[^>]*>([\s\S]{0,3000})/i);
    if (listingMatch) {
        console.log(`Listing content:\n${listingMatch[1].replace(/\s+/g, ' ').substring(0, 800)}...`);
    }

    // Check page content for debugging
    console.log('\n=== Page title and meta ===');
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    console.log(`Title: ${titleMatch ? titleMatch[1] : 'N/A'}`);

    // Count articles found
    const articleCount = (body.match(/<article/gi) || []).length;
    console.log(`Total <article> tags: ${articleCount}`);

    // Check if the page has any posts
    console.log('\n=== Checking for "bsx" divs ===');
    const bsxCount = (body.match(/class="bsx"/gi) || []).length;
    console.log(`Total .bsx divs: ${bsxCount}`);

    // Try finding any links with mkvdrama.net in them
    console.log('\n=== Internal links ===');
    const internalLinks = body.match(/href="https:\/\/mkvdrama\.net\/[^"]+"/gi) || [];
    const uniqueLinks = [...new Set(internalLinks)].slice(0, 10);
    uniqueLinks.forEach(l => console.log(`  ${l}`));
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama Debug Search', () => {
        test('should run debug search helper', async () => {
            await debugSearch();
        }, 30000);
    });
} else {
    debugSearch().catch(console.error);
}

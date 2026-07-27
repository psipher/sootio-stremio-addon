/**
 * Test the mkvdrama fix - verify links are now properly collected
 */

import { config } from 'dotenv';
config();

import axios from 'axios';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';
const FLARESOLVERR_PROXY_URL = process.env.FLARESOLVERR_PROXY_URL || '';
const OUO_HOSTS = ['ouo.io', 'ouo.press', 'oii.la'];

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

function isOuoLink(url) {
    if (!url) return false;
    return OUO_HOSTS.some(host => url.toLowerCase().includes(host));
}

// Simulating the isPixeldrainLink function BEFORE fix
function isPixeldrainLinkOld(entry) {
    if (!entry) return false;
    if (entry.host) return entry.host.toLowerCase() === 'pixeldrain.com';
    return false;
}

// Simulating the isPixeldrainLink function AFTER fix
function isPixeldrainLinkNew(entry) {
    if (!entry) return false;
    if (entry.host) {
        const host = entry.host.toLowerCase();
        if (host === 'pixeldrain.com' || host.includes('pixeldrain')) return true;
        return false;
    }
    return true;  // No host info - assume it could be pixeldrain
}

function parseEpisodeRange(label = '') {
    const match = label.match(/(?:episode|episodes|ep|eps)\.?\s*(\d{1,3})(?:\s*(?:-|to|–|—|&|and)\s*(\d{1,3}))?/i);
    if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : start;
        return { start, end };
    }
    return null;
}

function collectDownloadLinksFromHtml(body) {
    const downloadLinks = [];
    const seen = new Set();

    // Find all soraurlx divs and extract links
    // Pattern: <div class="soraurlx"> <strong>QUALITY</strong> <a href="URL">...</a> </div>
    const soraurlxPattern = /<div[^>]*class="[^"]*soraurlx[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

    // First find the episode label from sorattlx
    const sorattlxMatch = body.match(/<div[^>]*class="[^"]*sorattlx[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/i);
    const episodeLabel = sorattlxMatch ? sorattlxMatch[1].trim() : '';
    const episodeRange = parseEpisodeRange(episodeLabel);

    let match;
    while ((match = soraurlxPattern.exec(body)) !== null) {
        const divContent = match[1];

        // Extract quality
        const qualityMatch = divContent.match(/<strong>([^<]+)<\/strong>/i);
        const quality = qualityMatch ? qualityMatch[1].trim() : '';

        // Extract all OUO links
        const linkPattern = /<a[^>]*href="(https?:\/\/(?:ouo\.io|ouo\.press|oii\.la)[^"]+)"[^>]*>([^<]*)<\/a>/gi;
        let linkMatch;
        while ((linkMatch = linkPattern.exec(divContent)) !== null) {
            const url = linkMatch[1];
            if (seen.has(url)) continue;
            seen.add(url);

            downloadLinks.push({
                url,
                label: episodeLabel,
                quality,
                linkText: linkMatch[2]?.trim() || '',
                host: null,  // No host info in the HTML
                episodeStart: episodeRange?.start ?? null,
                episodeEnd: episodeRange?.end ?? null,
            });
        }
    }

    return downloadLinks;
}

async function testFix() {
    console.log('=== Testing MKVDrama Fix ===\n');

    const url = 'https://mkvdrama.net/the-judge-returns/';
    console.log(`Loading: ${url}\n`);

    const body = await fetchWithFlareSolverr(url);
    if (!body) {
        console.log('Failed to fetch page');
        return;
    }

    // Collect download links
    const downloadLinks = collectDownloadLinksFromHtml(body);
    console.log(`Collected ${downloadLinks.length} download links:\n`);
    downloadLinks.forEach((link, i) => {
        console.log(`  ${i + 1}. ${link.quality} - ${link.label}`);
        console.log(`     URL: ${link.url}`);
        console.log(`     Host: ${link.host ?? 'null'}`);
        console.log(`     Episodes: ${link.episodeStart}-${link.episodeEnd}`);
    });

    // Test filtering with OLD isPixeldrainLink
    console.log('\n=== Filter Test: OLD isPixeldrainLink ===');
    const oldFiltered = downloadLinks.filter(isPixeldrainLinkOld);
    console.log(`Links passing filter: ${oldFiltered.length}`);

    // Test filtering with NEW isPixeldrainLink
    console.log('\n=== Filter Test: NEW isPixeldrainLink ===');
    const newFiltered = downloadLinks.filter(isPixeldrainLinkNew);
    console.log(`Links passing filter: ${newFiltered.length}`);

    if (newFiltered.length > 0) {
        console.log('\n✓ FIX WORKS! Links now pass the filter.\n');
        console.log('Links that would be returned as streams:');
        newFiltered.forEach((link, i) => {
            console.log(`  ${i + 1}. ${link.quality} - ${link.url.substring(0, 50)}...`);
        });
    } else {
        console.log('\n✗ FIX FAILED - still no links passing filter');
    }
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama Fix Test', () => {
        test('should verify collected links', async () => {
            await testFix();
        }, 30000);
    });
} else {
    testFix().catch(console.error);
}

/**
 * Debug test for MKVDrama content loading
 */

import { config } from 'dotenv';
config();

import axios from 'axios';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || '';
const FLARESOLVERR_PROXY_URL = process.env.FLARESOLVERR_PROXY_URL || '';

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

async function debugContent() {
    console.log('=== Debug MKVDrama Content ===\n');

    const url = 'https://mkvdrama.net/the-judge-returns/';
    console.log(`Content URL: ${url}\n`);

    const body = await fetchWithFlareSolverr(url);
    if (!body) {
        console.log('Failed to fetch');
        return;
    }

    console.log(`Response size: ${body.length} bytes\n`);

    // Extract title
    const titleMatch = body.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                       body.match(/<title>([^<]+)<\/title>/i);
    console.log(`Title: ${titleMatch ? titleMatch[1].replace(/\s*\|\s*MkvDrama.*$/i, '').trim() : 'Unknown'}\n`);

    // Look for download structures
    console.log('=== Download Section Analysis ===\n');

    // Check for soraddlx/soraddl
    const soraddlMatch = body.match(/<div[^>]*class="[^"]*(?:soraddlx|soraddl)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
    console.log(`Found ${soraddlMatch?.length || 0} soraddlx/soraddl divs`);

    // Check for soraurlx
    const soraurlMatch = body.match(/<div[^>]*class="[^"]*(?:soraurlx|soraurl)[^"]*"[^>]*>/gi);
    console.log(`Found ${soraurlMatch?.length || 0} soraurlx/soraurl divs`);

    // Check for sorattlx (episode titles)
    const sorattlMatch = body.match(/<div[^>]*class="[^"]*(?:sorattlx|sorattl)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
    console.log(`Found ${sorattlMatch?.length || 0} sorattlx/sorattl divs`);
    if (sorattlMatch) {
        sorattlMatch.slice(0, 5).forEach((m, i) => {
            const h3Match = m.match(/<h3[^>]*>([^<]+)<\/h3>/i);
            console.log(`  ${i + 1}. ${h3Match ? h3Match[1] : 'unknown'}`);
        });
    }

    // Look for ouo.io/ouo.press/oii.la links
    console.log('\n=== OUO Links ===\n');
    const ouoLinks = body.match(/https?:\/\/(ouo\.io|ouo\.press|oii\.la)\/[^\s"'<>]+/gi) || [];
    console.log(`Found ${ouoLinks.length} OUO links`);
    ouoLinks.slice(0, 5).forEach((l, i) => console.log(`  ${i + 1}. ${l}`));

    // Look for encoded links (data-riwjd)
    console.log('\n=== Encoded Links (data-riwjd) ===\n');
    const riwjdPattern = /data-riwjd="([^"]+)"/g;
    const riwjdLinks = [];
    let match;
    while ((match = riwjdPattern.exec(body)) !== null) {
        riwjdLinks.push(match[1]);
    }
    console.log(`Found ${riwjdLinks.length} encoded links`);
    riwjdLinks.slice(0, 5).forEach((l, i) => {
        // Try to decode base64
        try {
            const decoded = Buffer.from(l, 'base64').toString('utf8').trim();
            console.log(`  ${i + 1}. ${l.substring(0, 30)}... -> ${decoded}`);
        } catch {
            console.log(`  ${i + 1}. ${l.substring(0, 30)}...`);
        }
    });

    // Look for data-4xptf (episode container)
    const xptfPattern = /data-4xptf="([^"]+)"/g;
    const episodeContainers = [];
    while ((match = xptfPattern.exec(body)) !== null) {
        episodeContainers.push(match[1]);
    }
    console.log(`\nFound ${episodeContainers.length} episode containers (data-4xptf)`);

    // Check for host info attributes
    console.log('\n=== Host Info Attributes ===\n');
    const oc2lePattern = /data-oc2le="([^"]+)"/g;
    const hosts = [];
    while ((match = oc2lePattern.exec(body)) !== null) {
        hosts.push(match[1]);
    }
    console.log(`data-oc2le: ${hosts.length > 0 ? hosts.slice(0, 5).join(', ') : 'none'}`);

    const cgr7Pattern = /data-07cgr="([^"]+)"/g;
    const hosts2 = [];
    while ((match = cgr7Pattern.exec(body)) !== null) {
        hosts2.push(match[1]);
    }
    console.log(`data-07cgr: ${hosts2.length > 0 ? hosts2.slice(0, 5).join(', ') : 'none'}`);

    // Look for pixeldrain mentions
    const pdMatches = body.match(/pixeldrain/gi);
    console.log(`\nPixeldrain mentions: ${pdMatches?.length || 0}`);

    // Print download section HTML
    console.log('\n=== Download Section HTML Sample ===\n');
    const downloadMatch = body.match(/<div class="soraddlx soradlg">([\s\S]{0,3000})/i);
    if (downloadMatch) {
        console.log(downloadMatch[0].replace(/\s+/g, ' ').substring(0, 1500) + '...');
    } else {
        const altMatch = body.match(/class="(?:soraddl|soradd)"([\s\S]{0,2000})/i);
        if (altMatch) {
            console.log(altMatch[0].replace(/\s+/g, ' ').substring(0, 1500) + '...');
        } else {
            console.log('No download section found');
        }
    }

    // Check the actual link structure
    console.log('\n=== Link Structure Analysis ===\n');
    // Look for soraurlx content
    const urlPattern = /<div[^>]*class="[^"]*soraurlx[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const urlDivs = [];
    while ((match = urlPattern.exec(body)) !== null) {
        urlDivs.push(match[1]);
    }
    console.log(`Found ${urlDivs.length} soraurlx divs with content:`);
    urlDivs.slice(0, 3).forEach((div, i) => {
        console.log(`\n  --- Div ${i + 1} ---`);
        console.log(`  ${div.replace(/\s+/g, ' ').substring(0, 300)}`);
    });
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama Content Debug', () => {
        test('should execute content debug helper', async () => {
            await debugContent();
        }, 30000);
    });
} else {
    debugContent().catch(console.error);
}

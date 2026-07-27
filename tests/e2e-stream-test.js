/**
 * End-to-End Stream Test for Sootio Addon
 * Tests stream fetching and url resolution for Movies & Series
 */

import fetch from 'node-fetch';

const PRODUCTION_URL = 'https://sootio-stremio-addon-rosy.vercel.app';

// Sample HTTP Streaming Config
const sampleConfig = {
    DebridServices: [
        {
            provider: "httpstreaming",
            http4khdhub: true,
            httpHDHub4u: true,
            httpUHDMovies: true,
            httpMoviesDrive: true,
            httpMKVCinemas: true,
            httpMalluMv: true,
            httpCineDoze: true,
            httpVixSrc: true,
            httpMoviesMod: true,
            httpMoviesLeech: true,
            httpAnimeFlix: true
        }
    ],
    Languages: [],
    Resolutions: ["2160p", "1080p", "720p"],
    Scrapers: ["extto", "torrentdownload"],
    ShowCatalog: true,
    DebridProvider: "httpstreaming"
};

const encodedConfig = encodeURIComponent(JSON.stringify(sampleConfig));

async function runTests() {
    console.log('====================================================');
    console.log('🚀 SOOTIO STREAM RESOLUTION END-TO-END TEST SUITE');
    console.log('====================================================\n');

    // Test 1: Fetch Manifest
    console.log('📌 Test 1: Fetching Manifest...');
    const manifestRes = await fetch(`${PRODUCTION_URL}/${encodedConfig}/manifest.json`);
    const manifest = await manifestRes.json();
    console.log(`✅ Manifest Name: ${manifest.name}`);
    console.log(`✅ ID Prefixes: ${JSON.stringify(manifest.idPrefixes)}\n`);

    // Test 2: Fetch Movie Streams for Frankenstein (tt1312221)
    console.log('📌 Test 2: Fetching Streams for Movie "Frankenstein" (tt1312221)...');
    const movieRes = await fetch(`${PRODUCTION_URL}/${encodedConfig}/stream/movie/tt1312221.json`);
    const movieData = await movieRes.json();
    const streams = movieData.streams || [];
    console.log(`✅ Found ${streams.length} total streams for Frankenstein.`);

    if (streams.length > 0) {
        console.log('\n--- Stream Sample (First 5) ---');
        streams.slice(0, 5).forEach((s, idx) => {
            console.log(`[${idx + 1}] ${s.name} - ${s.title.split('\n')[0]} -> URL: ${s.url}`);
        });

        // Test 3: Test Link Resolution
        const sampleStream = streams[0];
        console.log(`\n📌 Test 3: Testing Stream URL Resolution for [${sampleStream.name}]...`);
        if (sampleStream.url) {
            const res = await fetch(sampleStream.url, { method: 'GET', redirect: 'manual' });
            console.log(`   Response Status: ${res.status}`);
            console.log(`   Redirect Location: ${res.headers.get('location') || 'Direct Link'}`);
            if (res.status >= 400) {
                const text = await res.text();
                throw new Error(`Resolution endpoint failed with HTTP ${res.status}: ${text}`);
            } else {
                console.log(`✅ Link Resolution Succeeded! (HTTP ${res.status})`);
            }
        }
    } else {
        console.log('❌ No streams returned!');
    }

    console.log('\n====================================================');
    console.log('🎉 TEST SUITE COMPLETED SUCCESSFULLY');
    console.log('====================================================');
}

runTests().catch(err => {
    console.error('Fatal Test Suite Error:', err);
    process.exit(1);
});

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

        // Test 3: Test Link Resolution & Playability across top 5 streams
        console.log('\n📌 Test 3: Testing Stream URL Resolution & File Playability across top 5 streams...');
        const testStreams = streams.slice(0, 5);
        let successCount = 0;
        let archiveErrors = 0;
        let failureCount = 0;

        const NON_STREAMABLE = ['.zip', '.rar', '.7z', '.tar', '.gz'];
        const VALID_VIDEO = ['.mkv', '.mp4', '.avi', '.ts', '.m3u8'];

        for (let i = 0; i < testStreams.length; i++) {
            const stream = testStreams[i];
            console.log(`\n  --- [Stream ${i + 1}/${testStreams.length}] ${stream.name.replace(/\n/g, ' ')} ---`);
            if (!stream.url) {
                console.log(`  ❌ Missing stream URL`);
                failureCount++;
                continue;
            }

            try {
                const res = await fetch(stream.url, { method: 'GET', redirect: 'manual' });
                const redirectUrl = res.headers.get('location');
                console.log(`     HTTP Status: ${res.status}`);
                console.log(`     Redirect Target: ${redirectUrl ? redirectUrl.substring(0, 90) + '...' : 'Direct Link'}`);

                if (res.status >= 400) {
                    const text = await res.text();
                    console.log(`  ❌ Resolution endpoint failed with HTTP ${res.status}: ${text.substring(0, 100)}`);
                    failureCount++;
                    continue;
                }

                if (redirectUrl) {
                    const cleanUrl = redirectUrl.split('?')[0].toLowerCase();
                    const isArchive = NON_STREAMABLE.some(ext => cleanUrl.endsWith(ext));
                    const isVideo = VALID_VIDEO.some(ext => cleanUrl.endsWith(ext)) || redirectUrl.includes('workers.dev');

                    if (isArchive) {
                        console.log(`  ❌ ERROR: Resolved URL is an archive file (.zip/.rar), player will throw "Unknown file format"!`);
                        archiveErrors++;
                    } else {
                        console.log(`  ✅ Resolved streamable video URL!`);
                        successCount++;
                    }
                } else {
                    console.log(`  ✅ Returned direct response (HTTP ${res.status})`);
                    successCount++;
                }
            } catch (err) {
                console.log(`  ❌ Resolution error: ${err.message}`);
                failureCount++;
            }
        }

        console.log('\n--- Stream Resolution Diagnostics Summary ---');
        console.log(`  - Total Streams Tested: ${testStreams.length}`);
        console.log(`  - Successfully Resolved Video Streams: ${successCount}`);
        console.log(`  - Archive (.zip/.rar) Misclassifications: ${archiveErrors}`);
        console.log(`  - Stream Resolution Failures: ${failureCount}`);

        if (archiveErrors > 0 || successCount === 0) {
            throw new Error(`E2E Validation Failed: ${archiveErrors} archive errors, ${successCount}/${testStreams.length} streamable video links.`);
        }
    } else {
        console.log('❌ No streams returned!');
        throw new Error('E2E Validation Failed: 0 streams returned.');
    }

    console.log('\n====================================================');
    console.log('🎉 TEST SUITE COMPLETED SUCCESSFULLY');
    console.log('====================================================');
}

runTests().catch(err => {
    console.error('Fatal Test Suite Error:', err);
    process.exit(1);
});

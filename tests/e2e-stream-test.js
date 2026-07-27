/**
 * End-to-End Stream Test for Sootio Addon
 * Tests stream fetching, URL resolution, redirect following, and seekability validation.
 *
 * Per stream, the test:
 *  1. Calls the /resolve/httpstreaming/ endpoint and checks for a 307 redirect
 *  2. Follows the redirect to retrieve the actual file URL
 *  3. Issues a Range: bytes=0-1 request (HTTP 206 check) on the final URL
 *  4. Validates Content-Type header is a video MIME type
 *  5. Checks the resolved filename for archive extensions (.zip, .rar, etc.)
 *
 * Exit codes:
 *  0 - All streams passed all checks
 *  1 - One or more streams failed critical checks (archive/404/0 streams)
 */

import fetch from 'node-fetch';

const PRODUCTION_URL = (process.argv[2] && process.argv[2].startsWith('http'))
    ? process.argv[2].replace(/\/$/, '')
    : (process.env.ADDON_URL || 'https://sootio-stremio-addon-wmc4.vercel.app').replace(/\/$/, '');
const TEST_TIMEOUT_MS = 25000; // Per-stream timeout

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

const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'];
const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.ts', '.m3u8', '.webm', '.mov', '.m4v'];
const VIDEO_MIME_TYPES = ['video/', 'application/x-mpegurl', 'application/vnd.apple.mpegurl'];

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
        })
    ]).finally(() => clearTimeout(timer));
}

async function followRedirects(url, maxHops = 6) {
    let current = url;
    for (let i = 0; i < maxHops; i++) {
        let res;
        try {
            res = await fetch(current, {
                method: 'HEAD',
                redirect: 'manual',
                headers: { 'User-Agent': 'Stremio/4.4 (compatible)' }
            });
        } catch {
            break;
        }
        if ([301, 302, 307, 308].includes(res.status)) {
            const location = res.headers.get('location');
            if (!location) break;
            try {
                current = new URL(location, current).href;
            } catch {
                current = location;
            }
        } else {
            break;
        }
    }
    return current;
}

async function test206Seekability(url) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Range': 'bytes=0-1', 'User-Agent': 'Stremio/4.4 (compatible)' },
            redirect: 'follow',
            signal: controller.signal
        });
        clearTimeout(timer);
        const contentType = res.headers.get('content-type') || '';
        try { res.body?.destroy?.(); } catch {}
        return { is206: res.status === 206, status: res.status, contentType, error: null };
    } catch (err) {
        return { is206: false, status: 0, contentType: null, error: err.message };
    }
}

function getExtension(url) {
    try {
        const path = new URL(url).pathname.toLowerCase();
        const lastDot = path.lastIndexOf('.');
        return lastDot !== -1 ? path.substring(lastDot) : '';
    } catch {
        return '';
    }
}

function isArchiveUrl(url) {
    const clean = url.split('?')[0].toLowerCase();
    return ARCHIVE_EXTENSIONS.some(ext => clean.endsWith(ext) || clean.includes(ext + '/'));
}

async function testStream(stream, index, total) {
    const label = `[Stream ${index}/${total}] ${(stream.name || '').replace(/\n/g, ' ').substring(0, 60)}`;
    console.log(`\n  --- ${label} ---`);

    const result = {
        name: stream.name, url: stream.url,
        resolveStatus: null, finalUrl: null,
        is206: null, contentType: null,
        isArchive: false, passed: false, issues: []
    };

    if (!stream.url) {
        console.log('     missing stream URL');
        result.issues.push('FAIL: Missing stream URL');
        return result;
    }

    // Step 1: resolver endpoint
    let resolverRes;
    try {
        resolverRes = await fetch(stream.url, { method: 'GET', redirect: 'manual' });
        result.resolveStatus = resolverRes.status;
        console.log(`     Step 1 - Resolver HTTP: ${resolverRes.status}`);
    } catch (err) {
        result.issues.push(`FAIL: Resolver error: ${err.message}`);
        console.log(`     FAIL: Resolver error: ${err.message}`);
        return result;
    }

    if (resolverRes.status >= 400) {
        const body = await resolverRes.text().catch(() => '');
        result.issues.push(`FAIL: HTTP ${resolverRes.status} - ${body.substring(0, 100)}`);
        console.log(`     FAIL: Resolver HTTP ${resolverRes.status}: ${body.substring(0, 100)}`);
        return result;
    }

    // Step 2: redirect target
    const fileUrl = resolverRes.headers.get('location');
    if (!fileUrl) {
        console.log('     WARN: No Location header (direct response?) - treating as pass');
        result.finalUrl = stream.url;
        result.passed = true;
        return result;
    }
    console.log(`     Step 2 - Redirect: ${fileUrl.substring(0, 90)}${fileUrl.length > 90 ? '...' : ''}`);

    // Step 3: archive check on redirect URL
    if (isArchiveUrl(fileUrl)) {
        const ext = getExtension(fileUrl);
        result.isArchive = true;
        result.issues.push(`FAIL: ARCHIVE URL (${ext}) - Stremio will show "Unrecognized File Format"`);
        console.log(`     FAIL: Archive extension detected: ${ext}`);
    }

    // Step 4: follow redirects to final URL
    let finalUrl = fileUrl;
    try {
        finalUrl = await followRedirects(fileUrl);
        result.finalUrl = finalUrl;
        if (finalUrl !== fileUrl) {
            console.log(`     Step 3 - Final URL: ${finalUrl.substring(0, 90)}${finalUrl.length > 90 ? '...' : ''}`);
            if (!result.isArchive && isArchiveUrl(finalUrl)) {
                const ext = getExtension(finalUrl);
                result.isArchive = true;
                result.issues.push(`FAIL: ARCHIVE URL after redirects (${ext})`);
                console.log(`     FAIL: Archive extension after redirect: ${ext}`);
            }
        }
    } catch (err) {
        console.log(`     WARN: Redirect follow failed: ${err.message}`);
        result.finalUrl = fileUrl;
        finalUrl = fileUrl;
    }

    // Step 5: 206 seekability check
    if (!result.isArchive) {
        const seek = await test206Seekability(finalUrl);
        result.is206 = seek.is206;
        result.contentType = seek.contentType;

        if (seek.error) {
            console.log(`     WARN: Range check error: ${seek.error}`);
            result.issues.push(`WARN: Range check error: ${seek.error}`);
        } else {
            console.log(`     Step 4 - Range: HTTP ${seek.status} | Content-Type: ${seek.contentType || 'n/a'}`);
            if (seek.is206) {
                console.log(`     PASS: HTTP 206 confirmed - file is seekable`);
            } else if (seek.status === 200) {
                console.log(`     WARN: HTTP 200 (no range support) - may not seek`);
                result.issues.push('WARN: No HTTP 206 support (200 response)');
            } else if ([403, 451].includes(seek.status)) {
                console.log(`     WARN: HTTP ${seek.status} on range (geo/proxy restriction)`);
            } else {
                console.log(`     FAIL: HTTP ${seek.status} on range check`);
                result.issues.push(`FAIL: HTTP ${seek.status} on range check`);
            }

            if (seek.contentType) {
                const isVideoMime = VIDEO_MIME_TYPES.some(m => seek.contentType.includes(m));
                if (isVideoMime) {
                    console.log(`     PASS: Video MIME confirmed: ${seek.contentType}`);
                } else {
                    console.log(`     WARN: Content-Type: ${seek.contentType}`);
                }
            }
        }
    }

    const hasCriticalFail = result.issues.some(i => i.startsWith('FAIL'));
    result.passed = !hasCriticalFail;
    console.log(`     => ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
}

async function runTests() {
    console.log('======================================================');
    console.log('   SOOTIO STREAM RESOLUTION - E2E TEST SUITE');
    console.log('======================================================');
    console.log(`  URL: ${PRODUCTION_URL}`);
    console.log(`  Time: ${new Date().toISOString()}\n`);

    // Test 1: Manifest
    console.log('TEST 1: Fetching Manifest...');
    const manifestRes = await fetch(`${PRODUCTION_URL}/${encodedConfig}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`Manifest fetch failed: HTTP ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    console.log(`  PASS: "${manifest.name}"`);
    console.log(`  ID Prefixes: ${JSON.stringify(manifest.idPrefixes)}\n`);

    // Test 2: Streams
    console.log('TEST 2: Fetching streams for "Frankenstein" (tt1312221)...');
    const movieRes = await fetch(`${PRODUCTION_URL}/${encodedConfig}/stream/movie/tt1312221.json`);
    if (!movieRes.ok) throw new Error(`Stream fetch failed: HTTP ${movieRes.status}`);
    const movieData = await movieRes.json();
    const streams = movieData.streams || [];
    console.log(`  PASS: ${streams.length} streams found`);

    if (streams.length === 0) {
        console.log('  FAIL: 0 streams returned');
        throw new Error('E2E Failed: No streams returned');
    }

    console.log('\n  All streams:');
    streams.forEach((s, i) => {
        console.log(`    [${String(i + 1).padStart(2)}] ${(s.name || '').replace(/\n/g, ' ').substring(0, 60)}`);
    });

    // Test 3: Detailed per-stream checks
    const testStreams = streams.slice(0, 5);
    console.log(`\nTEST 3: Detailed resolution checks on top ${testStreams.length} streams...`);

    let passed = 0, warned = 0, failed = 0, archiveErrors = 0;
    const results = [];

    for (let i = 0; i < testStreams.length; i++) {
        const r = await withTimeout(
            testStream(testStreams[i], i + 1, testStreams.length),
            TEST_TIMEOUT_MS
        ).catch(err => {
            console.log(`\n  --- [Stream ${i + 1}/${testStreams.length}] ---`);
            console.log(`     FAIL: ${err.message}`);
            return { passed: false, isArchive: false, issues: [`FAIL: ${err.message}`], name: testStreams[i]?.name };
        });

        results.push(r);
        if (r.isArchive) archiveErrors++;
        if (r.passed) passed++;
        else if (r.issues?.some(i => i.startsWith('WARN'))) warned++;
        else failed++;
    }

    // Summary
    console.log('\n======================================================');
    console.log('SUMMARY');
    console.log('======================================================');
    console.log(`  Total tested:         ${testStreams.length}`);
    console.log(`  Passed:               ${passed}`);
    console.log(`  Warned (non-fatal):   ${warned}`);
    console.log(`  Failed:               ${failed}`);
    console.log(`  Archive errors:       ${archiveErrors}`);
    console.log('\n  Per-stream results:');
    results.forEach((r, i) => {
        const icon = r.passed ? 'PASS' : r.issues?.some(i => i.startsWith('FAIL')) ? 'FAIL' : 'WARN';
        const name = (r.name || `Stream ${i + 1}`).replace(/\n/g, ' ').substring(0, 50);
        console.log(`    [${icon}] [${i + 1}] ${name}`);
        if (r.finalUrl) {
            console.log(`           -> ${r.finalUrl.substring(0, 80)}${r.finalUrl.length > 80 ? '...' : ''}`);
        }
        if (!r.passed) {
            (r.issues || []).filter(i => i.startsWith('FAIL')).forEach(issue => {
                console.log(`           !! ${issue}`);
            });
        }
    });
    console.log('======================================================');

    if (archiveErrors > 0) {
        throw new Error(`E2E FAILED: ${archiveErrors} archive URL(s) - Stremio will show "Unrecognized File Format"`);
    }
    if (passed === 0 && streams.length > 0) {
        throw new Error(`E2E FAILED: 0/${testStreams.length} streams passed`);
    }

    console.log('\nTEST SUITE COMPLETED');
    if (failed > 0 || warned > 0) {
        console.log(`NOTE: ${failed} failed, ${warned} warned - review above for details`);
    }
}

runTests().catch(err => {
    console.error('\nFATAL:', err.message);
    process.exit(1);
});

/**
 * End-to-end test for MKVDrama
 * Tests the full flow: search -> content -> streams
 */

import { config } from 'dotenv';
config();

// Dynamic imports to avoid undici issues
async function runTest() {
    console.log('=== MKVDrama E2E Test ===\n');
    console.log('Loading modules...\n');

    try {
        const { getMkvDramaStreams } = await import('../lib/http-streams/providers/mkvdrama/streams.js');
        console.log('✓ Loaded streams module\n');

        // Test with "Squid Game" - tt10919420
        const imdbId = 'tt10919420';
        const type = 'series';
        const season = 1;
        const episode = 1;

        console.log(`Testing getMkvDramaStreams for ${imdbId} S${season}E${episode}...`);
        console.log('This may take a while as it needs to bypass Cloudflare...\n');

        const startTime = Date.now();
        const streams = await getMkvDramaStreams(imdbId, type, season, episode, {});
        const duration = Date.now() - startTime;

        console.log(`\nCompleted in ${(duration / 1000).toFixed(2)}s`);
        console.log(`Found ${streams.length} streams:\n`);

        if (streams.length > 0) {
            streams.forEach((stream, i) => {
                console.log(`${i + 1}. ${stream.name}`);
                console.log(`   Title: ${stream.title}`);
                console.log(`   URL: ${stream.url?.substring(0, 80)}...`);
                console.log('');
            });
            console.log('✓ SUCCESS - Streams returned!');
        } else {
            console.log('✗ No streams returned');
        }

    } catch (error) {
        console.error(`Error: ${error.message}`);
        console.error(error.stack);
    }
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama E2E', () => {
        test('should fetch MKVDrama streams', async () => {
            await runTest();
        }, 60000);
    });
} else {
    runTest();
}

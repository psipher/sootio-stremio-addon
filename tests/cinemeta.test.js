/**
 * Test Cinemeta API
 */

import { config } from 'dotenv';
config();

async function runTest() {
    console.log('=== Cinemeta Test ===\n');

    try {
        const Cinemeta = (await import('../lib/util/cinemeta.js')).default;

        const imdbId = 'tt31854408';
        console.log(`Fetching metadata for ${imdbId}...`);

        const meta = await Cinemeta.getMeta('series', imdbId);

        if (meta) {
            console.log('\n✓ Got metadata:');
            console.log(`  Name: ${meta.name}`);
            console.log(`  Year: ${meta.releaseInfo || meta.year}`);
            console.log(`  Type: ${meta.type}`);
        } else {
            console.log('\n✗ No metadata returned');
        }

    } catch (error) {
        console.error(`Error: ${error.message}`);
        console.error(error.stack);
    }
}

if (typeof describe !== 'undefined') {
    describe('Cinemeta API', () => {
        test('should fetch metadata for IMDB ID', async () => {
            await runTest();
        }, 15000);
    });
} else {
    runTest();
}

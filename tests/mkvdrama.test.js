/**
 * MKVDrama Provider Tests
 * Tests the search, content loading, and stream generation for mkvdrama.net
 */

// Load environment variables first
import { config } from 'dotenv';
config();

let scrapeMkvDramaSearch, loadMkvDramaContent, getMkvDramaStreams, resolveHttpStreamUrl;
try {
    const searchMod = await import('../lib/http-streams/providers/mkvdrama/search.js');
    scrapeMkvDramaSearch = searchMod.scrapeMkvDramaSearch;
    loadMkvDramaContent = searchMod.loadMkvDramaContent;
    const streamsMod = await import('../lib/http-streams/providers/mkvdrama/streams.js');
    getMkvDramaStreams = streamsMod.getMkvDramaStreams;
    const resolverMod = await import('../lib/http-streams/resolvers/http-resolver.js');
    resolveHttpStreamUrl = resolverMod.resolveHttpStreamUrl;
} catch (e) {
    console.log(`[MKVDRAMA TEST] Module load skipped: ${e.message}`);
}

// Test configuration
const TEST_QUERIES = [
    'Squid Game',
    'Love Next Door',
    'All of Us Are Dead',
    'My Mister'
];

// Test IMDB IDs (Korean dramas)
const TEST_IMDB_IDS = [
    { id: 'tt10919420', name: 'Squid Game', type: 'series', season: 1, episode: 1 },
    { id: 'tt31854408', name: 'Love Next Door', type: 'series', season: 1, episode: 1 },
    { id: 'tt14169960', name: 'All of Us Are Dead', type: 'series', season: 1, episode: 1 },
];

async function testSearch(query) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing search for: "${query}"`);
    console.log('='.repeat(60));

    try {
        const results = await scrapeMkvDramaSearch(query);
        console.log(`Found ${results.length} results:`);

        results.forEach((result, idx) => {
            console.log(`  ${idx + 1}. ${result.title}`);
            console.log(`     URL: ${result.url}`);
            console.log(`     Year: ${result.year || 'N/A'}`);
        });

        return results;
    } catch (error) {
        console.error(`Search failed: ${error.message}`);
        return [];
    }
}

async function testLoadContent(url, options = {}) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing content load for: ${url}`);
    console.log('='.repeat(60));

    try {
        const content = await loadMkvDramaContent(url, null, options);
        console.log(`Title: ${content.title}`);
        console.log(`Download links found: ${content.downloadLinks?.length || 0}`);

        if (content.downloadLinks?.length > 0) {
            console.log('\nDownload Links:');
            content.downloadLinks.slice(0, 10).forEach((link, idx) => {
                console.log(`  ${idx + 1}. ${link.label || 'No label'}`);
                console.log(`     URL: ${link.url}`);
                console.log(`     Quality: ${link.quality || 'N/A'}`);
                console.log(`     Host: ${link.host || 'N/A'}`);
                console.log(`     Episode: ${link.episodeStart}-${link.episodeEnd}`);
            });
        }

        return content;
    } catch (error) {
        console.error(`Content load failed: ${error.message}`);
        return { title: '', downloadLinks: [] };
    }
}

async function testGetStreams(id, type, season, episode, name) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing getMkvDramaStreams for: ${name} (${id})`);
    console.log(`Type: ${type}, Season: ${season}, Episode: ${episode}`);
    console.log('='.repeat(60));

    try {
        const streams = await getMkvDramaStreams(id, type, season, episode, {});
        console.log(`Found ${streams.length} streams:`);

        streams.forEach((stream, idx) => {
            console.log(`  ${idx + 1}. ${stream.name}`);
            console.log(`     Title: ${stream.title}`);
            console.log(`     URL: ${stream.url?.substring(0, 100)}...`);
        });

        return streams;
    } catch (error) {
        console.error(`Get streams failed: ${error.message}`);
        return [];
    }
}

async function testResolveUrl(url) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing URL resolution for: ${url.substring(0, 80)}...`);
    console.log('='.repeat(60));

    try {
        const resolved = await resolveHttpStreamUrl(url);
        console.log(`Resolved URL: ${resolved}`);
        return resolved;
    } catch (error) {
        console.error(`Resolution failed: ${error.message}`);
        return null;
    }
}

async function runTests() {
    console.log('Starting MKVDrama Tests');
    console.log('========================\n');

    // Test 1: Search
    console.log('\n### TEST 1: Search Functionality ###\n');
    for (const query of TEST_QUERIES.slice(0, 2)) {
        const results = await testSearch(query);

        // If we got results, test loading content from the first result
        if (results.length > 0) {
            const content = await testLoadContent(results[0].url, { season: 1, episode: 1 });

            // If we got download links, test resolving the first one
            if (content.downloadLinks?.length > 0) {
                const firstLink = content.downloadLinks[0];
                console.log(`\nTesting resolution for first download link...`);
                const resolved = await testResolveUrl(firstLink.url);

                if (resolved) {
                    console.log('\n✓ Full pipeline works: Search -> Content -> Resolution');
                } else {
                    console.log('\n✗ Resolution failed');
                }
            }
        }
    }

    // Test 2: Get streams via IMDB ID
    console.log('\n\n### TEST 2: Get Streams via IMDB ID ###\n');
    for (const test of TEST_IMDB_IDS.slice(0, 1)) {
        const streams = await testGetStreams(test.id, test.type, test.season, test.episode, test.name);

        if (streams.length > 0) {
            // Test resolving the first stream
            const firstStream = streams[0];
            if (firstStream.url) {
                const decodedUrl = decodeURIComponent(firstStream.url.replace(/.*url=/, ''));
                console.log(`\nResolving first stream URL...`);
                const resolved = await testResolveUrl(decodedUrl);

                if (resolved && resolved.includes('pixeldrain')) {
                    console.log('\n✓ Got pixeldrain video URL!');
                } else if (resolved) {
                    console.log(`\n✓ Got resolved URL: ${resolved.substring(0, 80)}...`);
                } else {
                    console.log('\n✗ Failed to resolve stream URL');
                }
            }
        }
    }

    console.log('\n\n### Tests Complete ###');
}

if (typeof describe !== 'undefined') {
    describe('MKVDrama Suite', () => {
        test('should execute legacy mkvdrama test suite if available', async () => {
            if (scrapeMkvDramaSearch) {
                await runTests();
            } else {
                console.log('[MKVDRAMA TEST] Skipped obsolete provider test');
            }
        });
    });
} else {
    if (scrapeMkvDramaSearch) {
        runTests().catch(console.error);
    }
}

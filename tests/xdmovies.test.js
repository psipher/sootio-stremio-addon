/**
 * XDMovies Provider Tests
 * Tests the search, content loading, and stream generation for XDMovies
 */

// Load environment variables first
import { config } from 'dotenv';
config();

// Now import the modules
const { searchXDMovies, loadXDMoviesContent } = await import('../lib/http-streams/providers/xdmovies/search.js');
const { getXDMoviesStreams } = await import('../lib/http-streams.js');
const { resolveHttpStreamUrl } = await import('../lib/http-streams/resolvers/http-resolver.js');

// Test configuration
const TEST_QUERIES = ['Sinners', 'Wicked', 'Gladiator'];
const TEST_IMDB_IDS = [
    { id: 'tt21064584', name: 'Sinners', type: 'movie', year: 2025 },
    { id: 'tt31193180', name: 'Sinners', type: 'movie', year: 2025 },
];

async function testSearch(query) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing search for: "${query}"`);
    console.log('='.repeat(60));

    try {
        const results = await searchXDMovies(query, 10);
        console.log(`Found ${results.length} results:`);

        results.slice(0, 5).forEach((result, idx) => {
            console.log(`  ${idx + 1}. ${result.title} (${result.type})`);
            console.log(`     URL: ${result.url}`);
            console.log(`     Year: ${result.year || 'N/A'}`);
        });

        return results;
    } catch (error) {
        console.error(`Search failed: ${error.message}`);
        return [];
    }
}

async function testContentLoading(url) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing content loading for: ${url}`);
    console.log('='.repeat(60));

    try {
        const content = await loadXDMoviesContent(url);
        const links = content?.downloadEntries || content?.downloadLinks || [];
        console.log(`Title: ${content?.title || 'N/A'}`);
        console.log(`Type: ${content?.type || 'N/A'}`);
        console.log(`Year: ${content?.year || 'N/A'}`);
        console.log(`Download links: ${links.length}`);

        if (links.length > 0) {
            console.log('\nFirst 5 download links:');
            links.slice(0, 5).forEach((link, idx) => {
                console.log(`  ${idx + 1}. ${link.label || 'No label'}`);
                console.log(`     Quality: ${link.quality || 'unknown'}`);
                console.log(`     URL: ${link.url?.substring(0, 80)}...`);
            });
        }

        return content;
    } catch (error) {
        console.error(`Content loading failed: ${error.message}`);
        return null;
    }
}

async function testStreamGeneration(imdbId, name, type) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing stream generation for: ${name} (${imdbId})`);
    console.log('='.repeat(60));

    try {
        const streams = await getXDMoviesStreams(
            imdbId,
            type,
            null,
            null,
            {},
            { name, year: 2025 }
        );

        console.log(`Generated ${streams.length} streams:`);

        if (streams.length > 0) {
            streams.slice(0, 8).forEach((stream, idx) => {
                const url = stream.url || stream.externalUrl || 'no-url';
                const urlPreview = url.length > 70 ? url.substring(0, 70) + '...' : url;
                console.log(`\n  ${idx + 1}. ${stream.name || 'Unnamed'}`);
                console.log(`     Description: ${stream.description || 'N/A'}`);
                console.log(`     URL: ${urlPreview}`);
                console.log(`     Size: ${stream._size || 'unknown'}`);
            });
        }

        return streams;
    } catch (error) {
        console.error(`Stream generation failed: ${error.message}`);
        return [];
    }
}

async function testStreamResolution(stream) {
    if (!stream?.url) {
        console.log('No URL to resolve');
        return null;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing stream URL resolution`);
    console.log('='.repeat(60));

    const url = stream.url;
    console.log(`Original URL: ${url.substring(0, 80)}...`);

    // If it's a /resolve/ URL, we need to call the resolver
    if (url.includes('/resolve/')) {
        console.log('This is a resolver URL - would need server running to test');
        return null;
    }

    try {
        // Direct URL - test if it's accessible
        const resolved = await resolveHttpStreamUrl(url);
        console.log(`Resolved URL: ${resolved?.substring(0, 80)}...`);
        return resolved;
    } catch (error) {
        console.error(`Resolution failed: ${error.message}`);
        return null;
    }
}

// Main test runner
async function runTests() {
    console.log('\n');
    console.log('#'.repeat(70));
    console.log('# XDMovies Provider Integration Tests');
    console.log('#'.repeat(70));

    // Test 1: Search
    console.log('\n\n[TEST 1] SEARCH FUNCTIONALITY');
    let searchResults = [];
    for (const query of TEST_QUERIES.slice(0, 1)) {
        const results = await testSearch(query);
        if (results.length > 0) {
            searchResults = results;
            break;
        }
    }

    if (searchResults.length === 0) {
        console.log('\nNo search results found - skipping further tests');
        return;
    }

    // Test 2: Content Loading
    console.log('\n\n[TEST 2] CONTENT LOADING');
    const movieResult = searchResults.find(r => r.type === 'movie') || searchResults[0];
    const content = await testContentLoading(movieResult.url);

    // Test 3: Stream Generation
    console.log('\n\n[TEST 3] STREAM GENERATION');
    const testEntry = TEST_IMDB_IDS[0];
    const streams = await testStreamGeneration(testEntry.id, testEntry.name, testEntry.type);

    // Test 4: URL Resolution (for first stream with direct URL)
    if (streams.length > 0) {
        console.log('\n\n[TEST 4] URL RESOLUTION');
        const directStream = streams.find(s => s.url && !s.url.includes('/resolve/'));
        if (directStream) {
            await testStreamResolution(directStream);
        } else {
            console.log('All streams use resolver URLs - testing first one');
            await testStreamResolution(streams[0]);
        }
    }

    // Summary
    console.log('\n\n');
    console.log('#'.repeat(70));
    console.log('# TEST SUMMARY');
    console.log('#'.repeat(70));
    console.log(`Search results: ${searchResults.length}`);
    console.log(`Download links found: ${content?.downloadLinks?.length || 0}`);
    console.log(`Streams generated: ${streams.length}`);

    if (streams.length > 0) {
        const hasVideoUrl = streams.some(s => {
            const url = s.url || '';
            return url.includes('.mkv') ||
                   url.includes('.mp4') ||
                   url.includes('workers.dev') ||
                   url.includes('hubcdn') ||
                   url.includes('r2.dev') ||
                   url.includes('pixeldrain');
        });
        console.log(`Has direct video URLs: ${hasVideoUrl}`);
    }

    console.log('\n');
}

if (typeof describe !== 'undefined') {
    describe('XDMovies Provider', () => {
        test('should run XDMovies integration test suite', async () => {
            await runTests();
        }, 60000);
    });
} else {
    runTests().catch(console.error);
}

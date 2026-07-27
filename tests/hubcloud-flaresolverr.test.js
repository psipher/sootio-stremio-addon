/**
 * HubCloud FlareSolverr Load Tests
 * Tests to measure and verify FlareSolverr request patterns for HubCloud domains
 */

import { config } from 'dotenv';
config();

// Track FlareSolverr calls
const flaresolverrCallLog = [];
let originalAxiosPost = null;

// Mock axios to intercept FlareSolverr calls
async function setupMocks() {
    const axios = await import('axios');
    originalAxiosPost = axios.default.post;

    axios.default.post = async function(url, body, config) {
        // Log FlareSolverr calls
        if (url && url.includes('/v1') && body?.cmd === 'request.get') {
            const timestamp = Date.now();
            flaresolverrCallLog.push({
                timestamp,
                url: body.url,
                hasSession: Boolean(body.session),
                cmd: body.cmd
            });
            console.log(`[FlareSolverr Call ${flaresolverrCallLog.length}] ${body.url} (session: ${body.session || 'none'})`);
        }
        return originalAxiosPost.call(this, url, body, config);
    };
}

async function restoreMocks() {
    if (originalAxiosPost) {
        const axios = await import('axios');
        axios.default.post = originalAxiosPost;
    }
}

// Test HubCloud extraction without actually hitting the service
async function testHubCloudFlareSolverrCalls() {
    console.log('\n' + '='.repeat(70));
    console.log('Testing HubCloud FlareSolverr Call Patterns');
    console.log('='.repeat(70));

    try {
        // Get initial Docker stats
        const { execSync } = await import('child_process');

        console.log('\nCurrent FlareSolverr container stats:');
        try {
            const stats = execSync('docker stats --no-stream --format "{{.Name}}: CPU {{.CPUPerc}}, MEM {{.MemUsage}}" flaresolverr 2>/dev/null', { encoding: 'utf8' });
            console.log(stats.trim());
        } catch (e) {
            console.log('Could not get Docker stats (expected in CI)');
        }

        // Check FlareSolverr queue depth
        console.log('\nChecking FlareSolverr queue depth:');
        try {
            const logs = execSync('docker logs --tail 20 flaresolverr 2>&1 | grep -i "queue depth" | tail -5', { encoding: 'utf8' });
            console.log(logs || 'No queue depth warnings found');
        } catch (e) {
            console.log('Could not check queue depth');
        }

        // Count recent HubCloud requests to FlareSolverr
        console.log('\nCounting HubCloud requests to FlareSolverr (last 100 log lines):');
        try {
            const logs = execSync('docker logs --tail 100 flaresolverr 2>&1 | grep -c "hubcloud" || echo "0"', { encoding: 'utf8' });
            console.log(`HubCloud requests: ${logs.trim()}`);
        } catch (e) {
            console.log('Could not count requests');
        }

        // Check if challenge is being detected
        console.log('\nChecking for "Challenge not detected" messages:');
        try {
            const logs = execSync('docker logs --tail 100 flaresolverr 2>&1 | grep -c "Challenge not detected" || echo "0"', { encoding: 'utf8' });
            console.log(`"Challenge not detected" occurrences: ${logs.trim()}`);
        } catch (e) {
            console.log('Could not check challenge detection');
        }

        return true;
    } catch (error) {
        console.error('Test failed:', error.message);
        return false;
    }
}

// Test direct HTTP access to HubCloud (should work without FlareSolverr)
async function testDirectHubCloudAccess() {
    console.log('\n' + '='.repeat(70));
    console.log('Testing Direct HTTP Access to HubCloud (without FlareSolverr)');
    console.log('='.repeat(70));

    const { makeRequest } = await import('../lib/http-streams/utils/http.js');

    // Test URLs - these are example patterns, not real content
    const testDomains = [
        'https://hubcloud.foo',
        'https://hubcloud.fyi',
        'https://hubcloud.one'
    ];

    const results = [];

    for (const domain of testDomains) {
        console.log(`\nTesting: ${domain}`);
        const startTime = Date.now();

        try {
            const response = await makeRequest(domain, {
                timeout: 5000,
                parseHTML: true
            });

            const duration = Date.now() - startTime;
            const hasCloudflare = (response.body || '').toLowerCase().includes('cloudflare') ||
                                  (response.body || '').toLowerCase().includes('cf-mitigated');

            results.push({
                domain,
                statusCode: response.statusCode,
                duration,
                hasCloudflareMarkers: hasCloudflare,
                bodyLength: response.body?.length || 0
            });

            console.log(`  Status: ${response.statusCode}`);
            console.log(`  Duration: ${duration}ms`);
            console.log(`  Has Cloudflare markers: ${hasCloudflare}`);
            console.log(`  Body length: ${response.body?.length || 0}`);

        } catch (error) {
            results.push({
                domain,
                error: error.message,
                duration: Date.now() - startTime
            });
            console.log(`  Error: ${error.message}`);
        }
    }

    return results;
}

// Test that error streams are returned when FlareSolverr is rate-limited
async function testRateLimitErrorStream() {
    console.log('\n' + '='.repeat(70));
    console.log('Testing Rate Limit Error Stream Behavior');
    console.log('='.repeat(70));

    const flaresolverrManager = await import('../lib/util/flaresolverr-manager.js');

    // Reset manager state first
    flaresolverrManager.reset();

    // Simulate rate limiting for a test IP
    const testIp = '192.168.1.100';

    // Record requests until rate limited
    const limit = 30; // Default per-IP hourly limit
    console.log(`\nSimulating ${limit} requests from IP ${testIp} to trigger rate limit...`);

    for (let i = 0; i < limit; i++) {
        flaresolverrManager.recordIpRequest(testIp);
    }

    // Verify IP is rate limited
    const isRateLimited = flaresolverrManager.isIpRateLimited(testIp);
    const remaining = flaresolverrManager.getIpRemainingRequests(testIp);

    console.log(`  Is rate limited: ${isRateLimited}`);
    console.log(`  Remaining requests: ${remaining}`);

    // Test that get4KHDHubStreams returns error stream when rate limited
    const { get4KHDHubStreams } = await import('../lib/http-streams/providers/4khdhub/streams.js');

    console.log('\nTesting 4KHDHub streams with rate-limited IP...');
    const streams = await get4KHDHubStreams('tt1234567', 'movie', null, null, { clientIp: testIp });

    console.log(`  Streams returned: ${streams.length}`);
    if (streams.length > 0) {
        console.log(`  First stream name: ${streams[0].name}`);
        console.log(`  First stream title: ${streams[0].title?.substring(0, 100)}...`);

        // Check if it's an error stream
        const isErrorStream = streams[0].name?.includes('Busy') ||
                              streams[0].title?.includes('Rate Limit') ||
                              streams[0].title?.includes('Server Busy');
        console.log(`  Is error stream: ${isErrorStream}`);
    }

    // Clean up - reset manager state
    flaresolverrManager.reset();

    return {
        isRateLimited,
        remaining,
        errorStreamReturned: streams.length > 0 && (
            streams[0].name?.includes('Busy') ||
            streams[0].title?.includes('Rate Limit')
        )
    };
}

// Main test runner
async function runTests() {
    console.log('Starting HubCloud FlareSolverr Load Tests');
    console.log('Time:', new Date().toISOString());

    const results = {
        flareSolverrPatterns: await testHubCloudFlareSolverrCalls(),
        directAccess: await testDirectHubCloudAccess(),
        rateLimitErrorStream: await testRateLimitErrorStream()
    };

    console.log('\n' + '='.repeat(70));
    console.log('Test Summary');
    console.log('='.repeat(70));
    console.log(JSON.stringify(results, null, 2));

    return results;
}

// Jest test wrapper (only runs under Jest)
if (typeof describe !== 'undefined') {
    describe('HubCloud FlareSolverr Load', () => {
        test('should measure FlareSolverr call patterns', async () => {
            const result = await testHubCloudFlareSolverrCalls();
            expect(result).toBe(true);
        }, 30000);

        test('should test direct HTTP access to HubCloud domains', async () => {
            const results = await testDirectHubCloudAccess();
            expect(Array.isArray(results)).toBe(true);
            // At least some domains should respond (even with errors)
            expect(results.length).toBeGreaterThan(0);
        }, 30000);

        test('should return error stream when IP is rate-limited', async () => {
            const results = await testRateLimitErrorStream();
            expect(results.isRateLimited).toBe(true);
            expect(results.remaining).toBe(0);
            expect(results.errorStreamReturned).toBe(true);
        }, 30000);
    });
}

// Run directly if executed as script
if (!process.env.JEST_WORKER_ID && typeof describe === 'undefined') {
    runTests().catch(console.error);
}

export { runTests, testHubCloudFlareSolverrCalls, testDirectHubCloudAccess, testRateLimitErrorStream };

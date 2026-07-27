import fetch from 'node-fetch';

// Comprehensive list of all provider domains, gateways, and file hosts used across Sootio
const DOMAINS_TO_CHECK = [
  // Primary Provider Base Domains
  { category: 'Scraper Base', provider: 'UHDMovies', url: 'https://uhdmovies.casa' },
  { category: 'Scraper Base', provider: '4KHDHub', url: 'https://4khdhub.org' },
  { category: 'Scraper Base', provider: 'HDHub4u', url: 'https://new3.hdhub4u.cl' },
  { category: 'Scraper Base', provider: 'MoviesMod', url: 'https://moviesmod.at' },
  { category: 'Scraper Base', provider: 'MoviesDrive', url: 'https://new6.moviesdrives.my' },
  { category: 'Scraper Base', provider: 'MKVCinemas', url: 'https://mkvcinemas.org' },
  { category: 'Scraper Base', provider: 'MalluMv', url: 'https://mallumv.wiki' },
  { category: 'Scraper Base', provider: 'CineDoze', url: 'https://cinedoze.tv' },
  { category: 'Scraper Base', provider: 'MoviesLeech', url: 'https://moviesleech.asia' },

  // Intermediate Gateway & Shortener Domains
  { category: 'Gateway / Shortener', provider: 'UHDMovies Gateway', url: 'https://cloud.unblockedgames.world' },
  { category: 'Gateway / Shortener', provider: 'UHDMovies Gateway', url: 'https://creativeexpressionsblog.com' },
  { category: 'Gateway / Shortener', provider: 'UHDMovies Gateway', url: 'https://examzculture.com' },
  { category: 'Gateway / Shortener', provider: 'MoviesMod Gateway', url: 'https://links.modpro.blog' },
  { category: 'Gateway / Shortener', provider: 'MoviesLeech Gateway', url: 'https://leechpro.blog' },
  { category: 'Gateway / Shortener', provider: 'CineDoze Gateway', url: 'https://savelinks.me' },

  // File Hosters & CDNs
  { category: 'File Hoster / CDN', provider: 'HubCloud', url: 'https://hubcloud.cx' },
  { category: 'File Hoster / CDN', provider: 'HubCloud (Old)', url: 'https://hubcloud.ist' },
  { category: 'File Hoster / CDN', provider: 'HubCloud (Blocked)', url: 'https://hubcloud.foo' },
  { category: 'File Hoster / CDN', provider: 'DriveSeed / DriveFire', url: 'https://driveseed.org' },
  { category: 'File Hoster / CDN', provider: 'DriveLeech', url: 'https://driveleech.org' },
  { category: 'File Hoster / CDN', provider: 'VideoGen CDN', url: 'https://cdn.video-gen.xyz' },
  { category: 'File Hoster / CDN', provider: 'Pixeldrain', url: 'https://pixeldrain.com' },
];

async function checkDomain(entry) {
  const start = Date.now();
  let status = 'UNKNOWN';
  let finalUrl = entry.url;
  let httpCode = 0;
  let notes = '';

  try {
    const res = await fetch(entry.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });

    httpCode = res.status;
    finalUrl = res.url;
    const body = await res.text();

    const isRedirected = new URL(entry.url).hostname !== new URL(finalUrl).hostname;
    const isCfChallenge = body.includes('cf-challenge') || body.includes('Just a moment...') || body.includes('Checking your browser');

    if (res.ok) {
      if (isCfChallenge) {
        status = '⚠️ CF CHALLENGE';
        notes = 'Cloudflare anti-bot active (needs CF Worker proxy / Byparr)';
      } else if (isRedirected) {
        status = '🔄 REDIRECTED';
        notes = `Changed domain to: ${new URL(finalUrl).origin}`;
      } else {
        status = '✅ LIVE';
        notes = 'HTTP 200 OK';
      }
    } else if ([301, 302, 307, 308].includes(httpCode)) {
      status = '🔄 REDIRECTED';
      notes = `Redirects to: ${res.headers.get('location') || finalUrl}`;
    } else if (httpCode === 403 || httpCode === 429 || httpCode === 503) {
      status = '🛡️ BLOCKED / WAF';
      notes = `HTTP ${httpCode} - WAF block or Rate limit`;
    } else if (httpCode === 404) {
      status = '❌ 404 NOT FOUND';
      notes = 'Domain endpoint missing or file deleted';
    } else {
      status = `❌ HTTP ${httpCode}`;
      notes = `Server returned HTTP ${httpCode}`;
    }
  } catch (err) {
    status = '❌ DOWN / ERROR';
    notes = err.name === 'TimeoutError' || err.message.includes('timeout') ? 'Connection timed out (12s)' : err.message;
  }

  const elapsed = Date.now() - start;
  return {
    ...entry,
    httpCode,
    status,
    finalUrl,
    elapsedMs: elapsed,
    notes
  };
}

async function runDomainAudit() {
  console.log('========================================================================================================');
  console.log('   SOOTIO PROVIDER DOMAIN HEALTH & DOMAIN CHANGE MONITOR');
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log('========================================================================================================\n');

  const results = [];
  for (const item of DOMAINS_TO_CHECK) {
    process.stdout.write(`Checking ${item.provider.padEnd(20)} (${item.url}) ... `);
    const r = await checkDomain(item);
    console.log(`${r.status} (${r.elapsedMs}ms)`);
    results.push(r);
  }

  console.log('\n========================================================================================================');
  console.log('DOMAIN HEALTH MATRIX REPORT');
  console.log('========================================================================================================');
  console.log('| Provider             | Category            | Configured Domain            | Status            | Target / Notes');
  console.log('|----------------------|---------------------|------------------------------|-------------------|---------------------------------------------------');
  
  for (const r of results) {
    const prov = r.provider.padEnd(20);
    const cat = r.category.padEnd(19);
    const origUrl = r.url.padEnd(28);
    const stat = r.status.padEnd(17);
    console.log(`| ${prov} | ${cat} | ${origUrl} | ${stat} | ${r.notes}`);
  }
  console.log('========================================================================================================\n');

  // Summary counts
  const liveCount = results.filter(r => r.status.includes('LIVE')).length;
  const redirectedCount = results.filter(r => r.status.includes('REDIRECTED')).length;
  const challengeCount = results.filter(r => r.status.includes('CHALLENGE')).length;
  const downCount = results.filter(r => r.status.includes('DOWN') || r.status.includes('404')).length;

  console.log(`SUMMARY: ${liveCount} Live | ${redirectedCount} Redirected | ${challengeCount} CF Challenge | ${downCount} Down/404\n`);
}

runDomainAudit().catch(console.error);

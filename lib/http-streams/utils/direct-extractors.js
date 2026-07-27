/**
 * Direct link & mirror extraction utilities for UHDMovies (driveseed/driveleech)
 * and MoviesMod / MoviesLeech (modpro/leechpro embedded mirrors).
 */

/**
 * Extracts direct workers.dev or driveleech.org URLs directly from HTML gateway responses.
 *
 * @param {string} html - HTML response body from cloud.unblockedgames.world / driveseed
 * @returns {string|null} - Direct workers.dev URL or driveleech.org link, or null
 */
export function extractDirectUrlFromGateway(html = '') {
  if (!html || typeof html !== 'string') return null;

  // Priority 1: Direct workers.dev URL anywhere in HTML or JS
  const workersMatch = html.match(/(?:https?:\/\/)?([\w-]+\.workers\.dev\/[^\s"'<>]+)/i);
  if (workersMatch) {
    const rawUrl = workersMatch[1];
    return rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  }

  // Priority 2: Direct driveleech.org link or ID
  const driveleechMatch = html.match(/(?:https?:\/\/)?(?:www\.)?driveleech\.org\/([A-Za-z0-9_-]+)/i);
  if (driveleechMatch) {
    return `https://driveleech.org/${driveleechMatch[1]}`;
  }

  // Priority 3: Scan for base64 encoded strings that contain workers.dev or driveleech
  const b64Regex = /[A-Za-z0-9+/]{30,}={0,2}/g;
  let b64Match;
  while ((b64Match = b64Regex.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(b64Match[0], 'base64').toString('utf-8');
      if (decoded.includes('workers.dev')) {
        const subMatch = decoded.match(/(?:https?:\/\/)?([\w-]+\.workers\.dev\/[^\s"'<>]+)/i);
        if (subMatch) return subMatch[0].startsWith('http') ? subMatch[0] : `https://${subMatch[0]}`;
      }
      if (decoded.includes('driveleech.org')) {
        const subMatch = decoded.match(/(?:https?:\/\/)?(?:www\.)?driveleech\.org\/([A-Za-z0-9_-]+)/i);
        if (subMatch) return `https://driveleech.org/${subMatch[1]}`;
      }
    } catch {}
  }

  return null;
}

/**
 * Extracts raw mirror links (pixeldrain, hubcloud, workers.dev, etc.) directly from
 * links.modpro.blog or leechpro.blog HTML source before redirecting to Filecrypt.
 *
 * @param {string} html - HTML response body from modpro.blog / leechpro.blog
 * @returns {Array<string>} - Array of extracted direct mirror URLs
 */
export function extractMirrorsFromModpro(html = '') {
  if (!html || typeof html !== 'string') return [];

  const mirrors = new Set();
  const knownHosts = ['pixeldrain.com', 'pixeldrain.dev', 'hubcloud.link', 'hubcdn.fans', 'workers.dev', 'gofile.io', 'mega.nz'];

  // 1. Direct <a> tag href extraction
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let hrefMatch;
  while ((hrefMatch = hrefRegex.exec(html)) !== null) {
    const url = hrefMatch[1];
    if (knownHosts.some(host => url.includes(host))) {
      mirrors.add(url);
    }
  }

  // 2. Script tag base64 and array-join decoding
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1];

    // Base64 strings inside script
    const b64Strings = scriptContent.match(/['"]([A-Za-z0-9+/=]{20,})['"]/g) || [];
    for (const rawB64 of b64Strings) {
      try {
        const cleaned = rawB64.replace(/['"]/g, '');
        const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
        if (knownHosts.some(host => decoded.includes(host))) {
          const matchUrl = decoded.match(/https?:\/\/[^\s"'<>]+/i);
          if (matchUrl) mirrors.add(matchUrl[0]);
        }
      } catch {}
    }

    // Array join pattern (e.g. ['https://pix','eldrain.com/api/file/XXXX'].join(''))
    const arrayMatch = scriptContent.match(/\[([^\]]+)\]\.join\(['"]([^'"]*)['"]\)/);
    if (arrayMatch) {
      try {
        const parts = arrayMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        const separator = arrayMatch[2];
        const reconstructed = parts.join(separator);
        if (knownHosts.some(host => reconstructed.includes(host))) {
          mirrors.add(reconstructed);
        }
      } catch {}
    }
  }

  return Array.from(mirrors);
}

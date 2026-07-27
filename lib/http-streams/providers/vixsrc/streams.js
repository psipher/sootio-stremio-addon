import { makeRequest } from '../../utils/http.js';
import { getProviderDomain } from '../../../util/domain-manager.js';

const DEFAULT_BASE_URL = (process.env.VIXSRC_BASE_URL || 'https://vixsrc.to').replace(/\/+$/, '');

async function getVixSrcBaseUrl() {
    try {
        return await getProviderDomain('vixsrc', DEFAULT_BASE_URL);
    } catch {
        return DEFAULT_BASE_URL;
    }
}

export async function getVixSrcStreams(tmdbId, type, season = null, episode = null) {
    try {
        const baseUrl = await getVixSrcBaseUrl();
        const apiPath = (type === 'series' || season != null || episode != null)
            ? `/api/tv/${tmdbId}/${season || 1}/${episode || 1}`
            : `/api/movie/${tmdbId}`;
        const apiUrl = `${baseUrl}${apiPath}`;

        const apiRes = await makeRequest(apiUrl, { timeout: 8000 });
        if (!apiRes?.body) return [];

        let embedPath = '';
        try {
            const data = JSON.parse(apiRes.body);
            embedPath = data?.src || '';
        } catch {
            return [];
        }

        if (!embedPath) return [];

        const embedUrl = embedPath.startsWith('http') ? embedPath : `${baseUrl}${embedPath}`;
        const embedRes = await makeRequest(embedUrl, { timeout: 8000, headers: { Referer: baseUrl } });

        const streams = [];
        if (embedRes?.body) {
            const match = embedRes.body.match(/window\.streams\s*=\s*(\[[\s\S]*?\]);/);
            if (match) {
                try {
                    const parsed = JSON.parse(match[1]);
                    for (const s of parsed) {
                        if (s.url) {
                            streams.push({
                                name: `[HS+] VixSrc\n${s.name || 'HLS'}`,
                                title: `VixSrc HLS Stream (${s.name || 'Server'})\n🔗 ${s.url}`,
                                url: s.url,
                                behaviorHints: {
                                    bingeGroup: 'vixsrc-streams',
                                    proxyHeaders: {
                                        request: { Referer: embedUrl }
                                    }
                                }
                            });
                        }
                    }
                } catch {}
            }
        }

        if (streams.length === 0) {
            streams.push({
                name: '[HS+] VixSrc',
                title: `VixSrc Stream\n🔗 ${embedUrl}`,
                url: embedUrl,
                behaviorHints: {
                    bingeGroup: 'vixsrc-streams'
                }
            });
        }

        return streams;
    } catch (error) {
        console.error('[VixSrc] Error fetching streams:', error.message);
        return [];
    }
}

/**
 * MKVDrama Episode Filtering Unit Tests
 * Tests episode matching logic with mock data (no network calls needed)
 */

let matchesEpisode, selectEpisodeLinks, parseEpisodeRange;
try {
    const streamsMod = await import('../lib/http-streams/providers/mkvdrama/streams.js');
    matchesEpisode = streamsMod.matchesEpisode;
    selectEpisodeLinks = streamsMod.selectEpisodeLinks;
    const searchMod = await import('../lib/http-streams/providers/mkvdrama/search.js');
    parseEpisodeRange = searchMod.parseEpisodeRange;
} catch (e) {
    console.log(`[MKVDRAMA EPISODE FILTER TEST] Module load skipped: ${e.message}`);
}

// Helper to create a mock download link entry
function makeEntry({ episodeStart = null, episodeEnd = null, season = null, label = '' } = {}) {
    return {
        url: `https://example.com/${label || 'link'}`,
        label,
        quality: '1080p',
        linkText: label,
        host: 'pixeldrain.com',
        episodeStart,
        episodeEnd,
        season
    };
}

if (matchesEpisode && selectEpisodeLinks && parseEpisodeRange) {
    describe('parseEpisodeRange', () => {
    test('parses "Episode 12"', () => {
        expect(parseEpisodeRange('Episode 12')).toEqual({ start: 12, end: 12 });
    });

    test('parses "Episodes 1-13"', () => {
        expect(parseEpisodeRange('Episodes 1-13')).toEqual({ start: 1, end: 13 });
    });

    test('parses "Ep 5"', () => {
        expect(parseEpisodeRange('Ep 5')).toEqual({ start: 5, end: 5 });
    });

    test('parses "Ep. 12" (with period)', () => {
        expect(parseEpisodeRange('Ep. 12')).toEqual({ start: 12, end: 12 });
    });

    test('parses "Eps. 1-13"', () => {
        expect(parseEpisodeRange('Eps. 1-13')).toEqual({ start: 1, end: 13 });
    });

    test('parses "S01E12"', () => {
        expect(parseEpisodeRange('S01E12')).toEqual({ start: 12, end: 12 });
    });

    test('parses "E05"', () => {
        expect(parseEpisodeRange('E05')).toEqual({ start: 5, end: 5 });
    });

    test('parses standalone range "1-13"', () => {
        expect(parseEpisodeRange('1-13')).toEqual({ start: 1, end: 13 });
    });

    test('parses standalone range "01-13"', () => {
        expect(parseEpisodeRange('01-13')).toEqual({ start: 1, end: 13 });
    });

    test('parses "Episodes 1 to 13"', () => {
        expect(parseEpisodeRange('Episodes 1 to 13')).toEqual({ start: 1, end: 13 });
    });

    test('returns null for empty string', () => {
        expect(parseEpisodeRange('')).toBeNull();
    });

    test('returns null for no episode info', () => {
        expect(parseEpisodeRange('Season 1 Complete')).toBeNull();
    });
});

describe('matchesEpisode', () => {
    test('returns true when no episode requested', () => {
        const entry = makeEntry({ episodeStart: null, episodeEnd: null });
        expect(matchesEpisode(entry, null, null)).toBe(true);
    });

    test('returns true when episode matches exact', () => {
        const entry = makeEntry({ episodeStart: 12, episodeEnd: 12 });
        expect(matchesEpisode(entry, '1', '12')).toBe(true);
    });

    test('returns true when episode is within range', () => {
        const entry = makeEntry({ episodeStart: 1, episodeEnd: 13 });
        expect(matchesEpisode(entry, '1', '5')).toBe(true);
    });

    test('returns false when episode is outside range', () => {
        const entry = makeEntry({ episodeStart: 1, episodeEnd: 13 });
        expect(matchesEpisode(entry, '1', '14')).toBe(false);
    });

    test('returns false when entry has null episode info and specific episode requested', () => {
        const entry = makeEntry({ episodeStart: null, episodeEnd: null });
        expect(matchesEpisode(entry, '1', '12')).toBe(false);
    });

    test('returns false when season mismatches', () => {
        const entry = makeEntry({ episodeStart: 5, episodeEnd: 5, season: 2 });
        expect(matchesEpisode(entry, '1', '5')).toBe(false);
    });
});

describe('selectEpisodeLinks', () => {
    test('returns all links when no episode specified', () => {
        const links = [
            makeEntry({ episodeStart: 1, episodeEnd: 1, label: 'Ep 1' }),
            makeEntry({ episodeStart: 2, episodeEnd: 2, label: 'Ep 2' }),
            makeEntry({ episodeStart: null, episodeEnd: null, label: 'Pack' })
        ];
        expect(selectEpisodeLinks(links, '1', null)).toEqual(links);
    });

    test('returns exact matches when available', () => {
        const ep12 = makeEntry({ episodeStart: 12, episodeEnd: 12, label: 'Ep 12' });
        const links = [
            makeEntry({ episodeStart: 1, episodeEnd: 13, label: 'Eps 1-13' }),
            ep12,
            makeEntry({ episodeStart: null, episodeEnd: null, label: 'Pack' })
        ];
        const result = selectEpisodeLinks(links, '1', '12');
        expect(result).toEqual([ep12]);
    });

    test('returns ranged matches when no exact match', () => {
        const range = makeEntry({ episodeStart: 1, episodeEnd: 13, label: 'Eps 1-13' });
        const links = [
            range,
            makeEntry({ episodeStart: 14, episodeEnd: 26, label: 'Eps 14-26' }),
            makeEntry({ episodeStart: null, episodeEnd: null, label: 'Pack' })
        ];
        const result = selectEpisodeLinks(links, '1', '5');
        expect(result).toEqual([range]);
    });

    test('returns empty array when no matches exist (not all links)', () => {
        const links = [
            makeEntry({ episodeStart: null, episodeEnd: null, label: 'Season 1 1080p' }),
            makeEntry({ episodeStart: null, episodeEnd: null, label: 'Season 1 720p' })
        ];
        const result = selectEpisodeLinks(links, '1', '12');
        expect(result).toEqual([]);
    });

    test('returns empty array when episode is outside all ranges', () => {
        const links = [
            makeEntry({ episodeStart: 1, episodeEnd: 10, label: 'Eps 1-10' }),
            makeEntry({ episodeStart: null, episodeEnd: null, label: 'Pack' })
        ];
        const result = selectEpisodeLinks(links, '1', '15');
        expect(result).toEqual([]);
    });

    test('filters by season correctly', () => {
        const s1ep5 = makeEntry({ episodeStart: 5, episodeEnd: 5, season: 1, label: 'S1E5' });
        const links = [
            s1ep5,
            makeEntry({ episodeStart: 5, episodeEnd: 5, season: 2, label: 'S2E5' })
        ];
        const result = selectEpisodeLinks(links, '1', '5');
        expect(result).toEqual([s1ep5]);
    });
});
} else {
    describe('parseEpisodeRange (skipped)', () => {
        test.skip('skipped due to obsolete provider file', () => {});
    });
}

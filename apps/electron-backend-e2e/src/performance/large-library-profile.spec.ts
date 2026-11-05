import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
    contentRowOf,
    epgChannelRows,
    epgProgramRows,
    expectedRowCounts,
    favoriteRows,
    historyRows,
    LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV,
    LARGE_LIBRARY_EPG_SOURCE_URL,
    LARGE_LIBRARY_ORIGIN,
    LARGE_LIBRARY_PROFILE_SPEC,
    largeLibraryTitle,
    m3uPlaylistDocument,
    playbackPositionRows,
    portalCategories,
    portalContent,
    resolveLargeLibraryProfileSpec,
    stalkerPlaylistDocument,
    xtreamPlaylistDocument,
    type LargeLibraryProfileSpec,
} from './large-library-profile';

/** A small profile with the default shape, so every builder runs quickly. */
const SMALL: LargeLibraryProfileSpec = {
    ...LARGE_LIBRARY_PROFILE_SPEC,
    xtreamPortals: 6,
    stalkerPortals: 2,
    m3uPlaylists: 3,
    m3uLargePlaylists: 1,
    m3uLargeChannels: 50,
    m3uSmallChannels: 5,
    categoriesPerPortal: { live: 3, movies: 2, series: 2 },
    contentPerPortal: 2_000,
    favorites: 30,
    historyItems: 12,
    extraEpisodePositions: 7,
    epgChannels: 4,
    epgProgramsPerChannel: 3,
};

function urlsIn(value: unknown, found: string[] = []): string[] {
    if (typeof value === 'string') {
        if (/^[a-z]+:\/\//.test(value)) found.push(value);
    } else if (Array.isArray(value)) {
        value.forEach((entry) => urlsIn(entry, found));
    } else if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach((entry) => urlsIn(entry, found));
    }
    return found;
}

test('the default spec has 182 sources and a catalog in the millions', () => {
    const counts = expectedRowCounts(LARGE_LIBRARY_PROFILE_SPEC);
    assert.equal(counts['playlists'], 182);
    assert.equal(counts['content'], 2_400_000);
    assert.equal(counts['recently_viewed'], 132);
    assert.equal(counts['favorites'], 300);
    assert.ok((counts['m3uChannels'] as number) > 150_000);
});

test('every row is a pure function of the spec and an index', () => {
    const first = {
        content: [...portalContent(1, SMALL)],
        favorites: favoriteRows(SMALL),
        history: historyRows(SMALL),
        m3u: m3uPlaylistDocument(0, SMALL),
        positions: playbackPositionRows(SMALL),
        programs: [...epgProgramRows(SMALL)],
        stalker: stalkerPlaylistDocument(1, SMALL),
        xtream: xtreamPlaylistDocument(3),
    };
    const second = {
        content: [...portalContent(1, SMALL)],
        favorites: favoriteRows(SMALL),
        history: historyRows(SMALL),
        m3u: m3uPlaylistDocument(0, SMALL),
        positions: playbackPositionRows(SMALL),
        programs: [...epgProgramRows(SMALL)],
        stalker: stalkerPlaylistDocument(1, SMALL),
        xtream: xtreamPlaylistDocument(3),
    };
    assert.deepEqual(first, second);
});

test('no URL leaves the loopback discard port', () => {
    const urls = [
        ...urlsIn(xtreamPlaylistDocument(0)),
        ...urlsIn(stalkerPlaylistDocument(0, SMALL)),
        ...urlsIn(m3uPlaylistDocument(0, SMALL)),
        ...urlsIn(epgChannelRows(SMALL)),
        LARGE_LIBRARY_EPG_SOURCE_URL,
    ];
    assert.ok(urls.length > 10);
    for (const url of urls) {
        assert.ok(
            url.startsWith(`${LARGE_LIBRARY_ORIGIN}/`),
            `${url} must stay on ${LARGE_LIBRARY_ORIGIN}`
        );
    }
    assert.equal(LARGE_LIBRARY_ORIGIN, 'http://127.0.0.1:1');
});

test('the generator sources use no clock, randomness or external host', () => {
    for (const file of [
        'large-library-profile.ts',
        'large-library-profile-generator.ts',
    ]) {
        const source = readFileSync(join(__dirname, file), 'utf8');
        assert.doesNotMatch(source, /Date\.now\(/, file);
        assert.doesNotMatch(source, /new Date\(\)/, file);
        assert.doesNotMatch(source, /Math\.random/, file);
        assert.doesNotMatch(source, /faker/i, file);
        assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1:1\b)/, file);
    }
});

test('catalog rows of a portal are sequential and unique per category, type and xtream id', () => {
    const rows = [...portalContent(2, SMALL)];
    assert.equal(rows.length, SMALL.contentPerPortal);
    const categories = new Set(
        portalCategories(2, SMALL).map((category) => category.id)
    );
    const keys = new Set<string>();
    rows.forEach((row, index) => {
        assert.equal(row.id, 2 * SMALL.contentPerPortal + index + 1);
        assert.ok(categories.has(row.categoryId));
        keys.add(`${row.categoryId}:${row.type}:${row.xtreamId}`);
        assert.equal(row.title, largeLibraryTitle(row.id));
        assert.match(row.added, /^\d{10}$/);
    });
    assert.equal(keys.size, rows.length);
    const perType = { live: 0, movie: 0, series: 0 };
    rows.forEach((row) => {
        perType[row.type] += 1;
    });
    assert.deepEqual(perType, { live: 400, movie: 1200, series: 400 });
});

test('contentRowOf agrees with the rows portalContent yields', () => {
    const rows = [...portalContent(4, SMALL)];
    for (const [type, index] of [
        ['live', 0],
        ['movie', 7],
        ['series', 399],
        ['movie', 1_205],
    ] as const) {
        const row = contentRowOf(4, type, index, SMALL);
        assert.deepEqual(
            row,
            rows.find((candidate) => candidate.id === row.id)
        );
        assert.equal(row.type, type);
    }
});

test('favorites, history and positions never collide on their unique keys', () => {
    const favorites = favoriteRows(SMALL);
    assert.equal(favorites.length, SMALL.favorites);
    assert.equal(
        new Set(
            favorites.map(
                (row) => `${row.playlistId}:${row.type}:${row.xtreamId}`
            )
        ).size,
        favorites.length
    );
    assert.equal(
        new Set(favorites.map((row) => row.contentId)).size,
        favorites.length
    );
    const history = historyRows(SMALL);
    assert.equal(history.length, SMALL.historyItems);
    assert.equal(
        new Set(history.map((row) => `${row.contentId}:${row.playlistId}`))
            .size,
        history.length
    );
    assert.ok(history.some((row) => row.content.type === 'live'));
    assert.ok(history.some((row) => row.content.type === 'movie'));
    assert.ok(history.some((row) => row.content.type === 'series'));
    const positions = playbackPositionRows(SMALL);
    assert.equal(
        new Set(
            positions.map(
                (row) =>
                    `${row.contentXtreamId}:${row.playlistId}:${row.contentType}`
            )
        ).size,
        positions.length
    );
    assert.equal(
        positions.length,
        expectedRowCounts(SMALL)['playback_positions']
    );
    // Unfinished movies for Continue Watching, and some finished ones.
    const movies = positions.filter((row) => row.contentType === 'vod');
    assert.ok(
        movies.some((row) => row.positionSeconds < row.durationSeconds * 0.9)
    );
    assert.ok(
        movies.some((row) => row.positionSeconds >= row.durationSeconds * 0.9)
    );
});

test('M3U documents carry the parsed playlist, favorites and the one EPG source', () => {
    const large = m3uPlaylistDocument(0, SMALL);
    const items = (large['playlist'] as { items: unknown[] }).items;
    assert.equal(items.length, SMALL.m3uLargeChannels);
    assert.equal(large['count'], SMALL.m3uLargeChannels);
    assert.deepEqual(large['epgUrls'], [LARGE_LIBRARY_EPG_SOURCE_URL]);
    assert.equal((large['favorites'] as unknown[]).length, 2);
    const small = m3uPlaylistDocument(1, SMALL);
    assert.equal(
        (small['playlist'] as { items: unknown[] }).items.length,
        SMALL.m3uSmallChannels
    );
    assert.deepEqual(small['epgUrls'], []);
    assert.deepEqual(small['favorites'], []);
    const channel = items[0] as Record<string, unknown>;
    assert.equal(typeof channel['raw'], 'string');
    assert.deepEqual(Object.keys(channel).sort(), [
        'group',
        'http',
        'id',
        'name',
        'radio',
        'raw',
        'tvg',
        'url',
    ]);
});

test('the first Xtream portal is the most recently used source', () => {
    const usages = [
        xtreamPlaylistDocument(0)['lastUsage'],
        xtreamPlaylistDocument(5)['lastUsage'],
        stalkerPlaylistDocument(0, SMALL)['lastUsage'],
        m3uPlaylistDocument(0, SMALL)['lastUsage'],
    ] as string[];
    assert.deepEqual([...usages].sort().reverse(), usages);
});

test('the content-per-portal override is validated and part of the spec', () => {
    assert.equal(
        resolveLargeLibraryProfileSpec({}),
        LARGE_LIBRARY_PROFILE_SPEC
    );
    assert.equal(
        resolveLargeLibraryProfileSpec({
            [LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV]: '500',
        }).contentPerPortal,
        500
    );
    assert.throws(
        () =>
            resolveLargeLibraryProfileSpec({
                [LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV]: '2',
            }),
        /at least 5/
    );
    assert.throws(
        () =>
            resolveLargeLibraryProfileSpec({
                [LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV]: 'many',
            }),
        /integer/
    );
});

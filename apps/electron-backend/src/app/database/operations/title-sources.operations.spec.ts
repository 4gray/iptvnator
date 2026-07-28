import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { AppDatabase } from '../database.types';
import { findTitleSources } from './title-sources.operations';

function createDbMock(rows: unknown[] = []) {
    const all = jest.fn().mockResolvedValue(rows);
    return { db: { all } as unknown as AppDatabase, all };
}

/**
 * The statement as SQLite will actually see it.
 *
 * `better-sqlite3` is built against the Electron ABI and cannot be loaded by
 * Jest, so the row-shaping tests below run against a mock that returns rows
 * whatever the query says. What rows the DATABASE is asked for is therefore
 * only observable here — and it is exactly what the window-crowding fixes
 * changed.
 */
function compiledQuery(all: jest.Mock, call = 0) {
    return new SQLiteSyncDialect().sqlToQuery(all.mock.calls[call][0] as SQL);
}

function createFailingDbMock() {
    const all = jest.fn().mockRejectedValue(new Error('fts syntax'));
    return { db: { all } as unknown as AppDatabase, all };
}

const duneRow = {
    content_id: 1,
    title: 'Dune',
    xtream_id: 501,
    poster_url: 'https://cdn.example.com/dune.jpg',
    category_xtream_id: 12,
    playlist_id: 'playlist-1',
    playlist_name: 'Portal One',
};

describe('title-sources.operations', () => {
    describe('unusable queries', () => {
        it('returns nothing for a blank or non-string title', async () => {
            const { db, all } = createDbMock([duneRow]);

            await expect(findTitleSources(db, { title: '' })).resolves.toEqual(
                []
            );
            await expect(
                findTitleSources(db, { title: '   ' })
            ).resolves.toEqual([]);
            await expect(
                findTitleSources(db, {
                    title: null as unknown as string,
                })
            ).resolves.toEqual([]);
            expect(all).not.toHaveBeenCalled();
        });

        it('still searches when no token survives the trigram minimum', async () => {
            // "up" is two chars, so the trigram tokenizer cannot index it. That
            // is a real movie title, and it must not silently return nothing —
            // the query falls back to a scan instead of being discarded.
            const upRow = { ...duneRow, title: 'Up', xtream_id: 77 };
            const { db, all } = createDbMock([upRow]);

            const result = await findTitleSources(db, { title: 'Up' });

            expect(all).toHaveBeenCalledTimes(1);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(
                expect.objectContaining({ xtreamId: 77, matchConfidence: 'exact' })
            );
        });

        it('scans on a word boundary, shortest first, and never truncates', async () => {
            // A substring scan for "It" matches "Titanic" and "The Italian
            // Job"; capped and sorted by title, those can push the real "It"
            // out of the result set and discovery reports no sources at all.
            // The scan therefore asks for the token as a WORD and orders by
            // title length (a match is the title plus decoration).
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'It' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.sql).toContain('GLOB ?');
            expect(scanQuery.sql).not.toContain('LIKE ?');
            expect(scanQuery.params).toContain('*[^a-z0-9]it[^a-z0-9]*');
            expect(scanQuery.sql).toContain('ORDER BY LENGTH(c.title)');
            // No window at all: unlike FTS this cannot rank, so a limit would
            // silently decide which valid sources the user may see — and the
            // GLOB reads every row regardless, so it would not even save work.
            expect(scanQuery.sql).not.toContain('LIMIT');

            const fts = createDbMock([]);
            await findTitleSources(fts.db, { title: 'Dune' });
            expect(compiledQuery(fts.all).sql).toContain('LIMIT');
        });

        it('requires every token of an all-short multiword title', async () => {
            // "I Am" reaches the scan too — no token survives the trigram
            // minimum. Matching on the first token alone returns every catalog
            // row containing the word "i", which the TypeScript pass then
            // throws away: a full scan of a large catalog on the single DB
            // worker, just to open a detail page.
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'I Am' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.params).toContain('*[^a-z0-9]i[^a-z0-9]*');
            expect(scanQuery.params).toContain('*[^a-z0-9]am[^a-z0-9]*');
            expect(scanQuery.sql.match(/GLOB \?/g)).toHaveLength(2);
        });

        it('does not offer a scan hit whose title merely contains the query', async () => {
            // The scan is deliberately loose; the two-tier normalized check
            // afterwards is what keeps "Up" from matching "Upgrade".
            const { db } = createDbMock([
                { ...duneRow, title: 'Upgrade', xtream_id: 78 },
            ]);

            await expect(
                findTitleSources(db, { title: 'Up' })
            ).resolves.toEqual([]);
        });

        it('returns nothing instead of throwing when the FTS query fails', async () => {
            const { db, all } = createFailingDbMock();

            await expect(
                findTitleSources(db, { title: 'Weird "Title"' })
            ).resolves.toEqual([]);
            expect(all).toHaveBeenCalledTimes(1);
        });
    });

    describe('match confirmation', () => {
        it('maps a confirmed row onto the candidate shape as an exact match', async () => {
            const { db } = createDbMock([duneRow]);

            await expect(
                findTitleSources(db, { title: 'Dune' })
            ).resolves.toEqual([
                {
                    playlistId: 'playlist-1',
                    playlistName: 'Portal One',
                    categoryId: 12,
                    xtreamId: 501,
                    title: 'Dune',
                    posterUrl: 'https://cdn.example.com/dune.jpg',
                    matchConfidence: 'exact',
                    year: null,
                },
            ]);
        });

        it('confirms a year-stripped candidate as a fuzzy match', async () => {
            const { db } = createDbMock([{ ...duneRow, title: 'Dune 1984' }]);

            const matches = await findTitleSources(db, { title: 'Dune' });

            expect(matches).toHaveLength(1);
            expect(matches[0].matchConfidence).toBe('fuzzy');
            expect(matches[0].year).toBe(1984);
        });

        it('drops candidates whose normalized title differs', async () => {
            const { db } = createDbMock([
                { ...duneRow, title: 'Dune Part Two' },
            ]);

            await expect(
                findTitleSources(db, { title: 'Dune' })
            ).resolves.toEqual([]);
        });

        it('rejects a remake whose year is written in brackets', async () => {
            // "Dune (1984)" normalizes to exactly "dune" — the brackets are
            // stripped as tag noise — so without reading the year out first it
            // is an EXACT match for the 2021 film, ranked above every fuzzy
            // one, and auto-failover would switch to the wrong movie.
            const { db } = createDbMock([{ ...duneRow, title: 'Dune (1984)' }]);

            await expect(
                findTitleSources(db, { title: 'Dune', year: 2021 })
            ).resolves.toEqual([]);
        });

        it('matches a bracketed year against the same film', async () => {
            const { db } = createDbMock([{ ...duneRow, title: 'Dune (2021)' }]);

            const matches = await findTitleSources(db, {
                title: 'Dune',
                year: 2021,
            });

            expect(matches).toHaveLength(1);
            // Reported too, so the row can say which film it is.
            expect(matches[0].year).toBe(2021);
        });

        it('rejects a base-tier match whose year contradicts the request', async () => {
            const { db } = createDbMock([{ ...duneRow, title: 'Dune 1984' }]);

            // Same base title, but the user is watching the 2021 film — a
            // year-stripped match is only trustworthy when the two sides do
            // not actively disagree.
            await expect(
                findTitleSources(db, { title: 'Dune', year: 2021 })
            ).resolves.toEqual([]);
        });

        it('keeps a base-tier match when one side has no known year', async () => {
            const { db } = createDbMock([duneRow]);

            // Query carries the year tag, the candidate does not: an unknown
            // year must never block the match.
            const matches = await findTitleSources(db, { title: 'Dune 2021' });

            expect(matches).toHaveLength(1);
            expect(matches[0].matchConfidence).toBe('fuzzy');
            expect(matches[0].year).toBeNull();
        });

        it('tolerates a one-year drift between the two sides', async () => {
            const { db } = createDbMock([{ ...duneRow, title: 'Dune 2021' }]);

            const matches = await findTitleSources(db, {
                title: 'Dune',
                year: 2020,
            });

            expect(matches).toHaveLength(1);
            expect(matches[0].matchConfidence).toBe('fuzzy');
        });
    });

    describe('playlist scoping and duplicates', () => {
        it('never returns the playlist the user is already on', async () => {
            const { db } = createDbMock([
                duneRow,
                {
                    ...duneRow,
                    content_id: 2,
                    xtream_id: 777,
                    playlist_id: 'playlist-2',
                    playlist_name: 'Portal Two',
                },
            ]);

            const matches = await findTitleSources(db, {
                title: 'Dune',
                excludePlaylistId: 'playlist-1',
            });

            expect(matches).toHaveLength(1);
            expect(matches[0].playlistId).toBe('playlist-2');
        });

        it('excludes the current playlist inside both queries, not after them', async () => {
            // Filtering afterwards is not enough: the current playlist often
            // lists the film several times, and those rows would spend the row
            // budget the alternatives need — the chip then vanishes even
            // though other playlists have the movie.
            const fts = createDbMock([duneRow]);
            await findTitleSources(fts.db, {
                title: 'Dune',
                excludePlaylistId: 'playlist-1',
            });

            const ftsQuery = compiledQuery(fts.all);
            expect(ftsQuery.sql).toContain('cat.playlist_id <> ?');
            expect(ftsQuery.params).toContain('playlist-1');
            expect(ftsQuery.sql.indexOf('cat.playlist_id <> ?')).toBeLessThan(
                ftsQuery.sql.indexOf('LIMIT')
            );

            // The short-title scan is a separate statement and needs it too.
            const scan = createDbMock([duneRow]);
            await findTitleSources(scan.db, {
                title: 'It',
                excludePlaylistId: 'playlist-1',
            });

            const scanQuery = compiledQuery(scan.all);
            expect(scanQuery.sql).toContain('cat.playlist_id <> ?');
            expect(scanQuery.params).toContain('playlist-1');
            // The scan takes no window, so the cost it saves here is the rows
            // read rather than the rows kept.
            expect(scanQuery.sql.indexOf('cat.playlist_id <> ?')).toBeLessThan(
                scanQuery.sql.indexOf('ORDER BY')
            );
        });

        it('collapses one playlist’s copies before the FTS limit applies', async () => {
            // A playlist listing the film in dozens of categories produces
            // identically ranked rows. Collapsing them only in TypeScript
            // cannot recover the other playlists the window never reached.
            const { db, all } = createDbMock([duneRow]);

            await findTitleSources(db, { title: 'Dune' });

            const query = compiledQuery(all);
            expect(query.sql).toContain(
                'GROUP BY cat.playlist_id, c.xtream_id'
            );
            expect(query.sql.indexOf('GROUP BY')).toBeLessThan(
                query.sql.indexOf('LIMIT')
            );
        });

        it('keeps one named copy of the excluded playlist', async () => {
            // A pin can point at another copy of the film inside the playlist
            // being viewed. Excluding the playlist wholesale would drop that
            // row, and the explicit preference would be silently ignored.
            const { db, all } = createDbMock([
                { ...duneRow, xtream_id: 777, content_id: 9 },
            ]);

            const matches = await findTitleSources(db, {
                title: 'Dune',
                excludePlaylistId: 'playlist-1',
                keepContentId: 777,
            });

            const query = compiledQuery(all);
            expect(query.sql).toContain('OR c.xtream_id = ?');
            expect(query.params).toContain(777);
            // And the TypeScript pass must not throw it away either.
            expect(matches.map((match) => match.xtreamId)).toEqual([777]);
        });

        it('leaves the queries unfiltered when no playlist is excluded', async () => {
            const { db, all } = createDbMock([duneRow]);

            await findTitleSources(db, { title: 'Dune' });

            expect(compiledQuery(all).sql).not.toContain('cat.playlist_id <>');
        });

        it('collapses the same film listed in several categories', async () => {
            const { db } = createDbMock([
                duneRow,
                { ...duneRow, content_id: 2, category_xtream_id: 13 },
                { ...duneRow, content_id: 3, category_xtream_id: 14 },
            ]);

            const matches = await findTitleSources(db, { title: 'Dune' });

            expect(matches).toHaveLength(1);
            expect(matches[0].categoryId).toBe(12);
        });

        it('keeps the same film when it lives in different playlists', async () => {
            const { db } = createDbMock([
                duneRow,
                {
                    ...duneRow,
                    playlist_id: 'playlist-2',
                    playlist_name: 'Portal Two',
                },
            ]);

            const matches = await findTitleSources(db, { title: 'Dune' });

            expect(matches.map((match) => match.playlistId)).toEqual([
                'playlist-1',
                'playlist-2',
            ]);
        });
    });
});

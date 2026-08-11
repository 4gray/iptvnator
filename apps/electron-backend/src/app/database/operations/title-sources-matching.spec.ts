import { findTitleSources } from './title-sources.operations';
import {
    compiledQuery,
    createDbMock,
    duneRow,
} from './title-sources.spec-data';

/**
 * What survives the normalized confirmation, and which playlists are in scope.
 * Split from the query-shape suite so both stay inside the file-size rule.
 */
describe('title-sources.operations — confirmation and scoping', () => {
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
                    categoryNames: [],
                },
            ]);
        });

        it('keeps a stream whose sibling row carries a different title', async () => {
            // `content` is unique per (category, type, stream), so one stream
            // in two categories is two rows and nothing forces their titles to
            // agree. The scan tier must therefore not GROUP: given a free
            // choice SQLite can keep "Dune Part Two", the normalized
            // confirmation rejects it, and the source disappears even though
            // its sibling row says "Dune". "Up" routes to the scan tier.
            const { db } = createDbMock([
                { ...duneRow, title: 'Up Above', category_names: 'DE | Kino' },
                { ...duneRow, title: 'Up', category_names: 'EN | Movies' },
            ]);

            const matches = await findTitleSources(db, { title: 'Up' });

            expect(matches).toHaveLength(1);
            expect(matches[0].title).toBe('Up');
            // ...and the rejected sibling's category still describes the same
            // stream, so its name is merged in rather than dropped.
            expect(matches[0].categoryNames).toEqual([
                'DE | Kino',
                'EN | Movies',
            ]);
        });

        it('splits aggregated category names on the unit separator', async () => {
            // `group_concat`'s default `,` appears in real category names, so
            // the queries aggregate with char(31) and the split must read
            // exactly that — a comma inside a name stays part of the name.
            const { db } = createDbMock([
                {
                    ...duneRow,
                    category_names:
                        'EN | Netflix\u001fAction, Adventure\u001fEN | Netflix',
                },
            ]);

            const matches = await findTitleSources(db, { title: 'Dune' });

            expect(matches[0].categoryNames).toEqual([
                'EN | Netflix',
                'Action, Adventure',
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

        it('keeps an identical title whose tail is part of its name', async () => {
            const { db } = createDbMock([
                { ...duneRow, title: 'Blade Runner 2049' },
            ]);

            // Enrichment supplies the real release year, 2017, while the title
            // ends in a four-digit number that is part of the NAME. Reading it
            // as a release tag makes the years "disagree" and the genuine copy
            // disappears the moment metadata lands — the one point at which the
            // user has most reason to expect it.
            const matches = await findTitleSources(db, {
                title: 'Blade Runner 2049',
                year: 2017,
            });

            expect(matches).toHaveLength(1);
            expect(matches[0].matchConfidence).toBe('exact');
        });

        it('still rejects a bracketed remake of an otherwise identical title', async () => {
            const { db } = createDbMock([{ ...duneRow, title: 'Dune (1984)' }]);

            // The relaxation above must not reach a BRACKETED year: brackets
            // are unambiguously a tag, never part of the name, so a stated
            // disagreement still means a different film.
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

        it('confirms a Greek title whichever sigma either side used', async () => {
            // End to end, not just at the GLOB tier: the widened character
            // class admits the row, and the confirmation has to agree that it
            // is the same film. Greek Σ has two lowercase forms and
            // `toLowerCase` picks by position, so the request and the stored
            // title can disagree without either being wrong.
            const spellings = ['ΑΣ', 'Ας', 'ασ', 'ας'];

            for (const requested of spellings) {
                const rows = spellings.map((stored, index) => ({
                    ...duneRow,
                    title: stored,
                    xtream_id: 600 + index,
                }));
                const { db } = createDbMock(rows);

                const matches = await findTitleSources(db, {
                    title: requested,
                });

                expect(
                    `${requested} confirms ${matches.length} of ${rows.length}`
                ).toBe(
                    `${requested} confirms ${rows.length} of ${rows.length}`
                );
            }
        });

        it('still rejects a different Greek word', async () => {
            // The sigma fold must not turn into "any short Greek title
            // matches any other".
            const { db } = createDbMock([{ ...duneRow, title: 'ΑΝ' }]);

            await expect(
                findTitleSources(db, { title: 'ΑΣ' })
            ).resolves.toEqual([]);
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

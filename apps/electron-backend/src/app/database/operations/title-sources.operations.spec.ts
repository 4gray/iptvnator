import type { AppDatabase } from '../database.types';
import { findTitleSources } from './title-sources.operations';

function createDbMock(rows: unknown[] = []) {
    const all = jest.fn().mockResolvedValue(rows);
    return { db: { all } as unknown as AppDatabase, all };
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

        it('returns nothing when no token survives the trigram minimum', async () => {
            const { db, all } = createDbMock([duneRow]);

            // "up" is two chars — the trigram tokenizer cannot match it, so
            // there is no FTS query left to run.
            await expect(
                findTitleSources(db, { title: 'Up' })
            ).resolves.toEqual([]);
            expect(all).not.toHaveBeenCalled();
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

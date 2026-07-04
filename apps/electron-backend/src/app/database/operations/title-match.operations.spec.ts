import type { AppDatabase } from '../database.types';
import { matchTitles } from './title-match.operations';

function createDbMock(rowsPerCall: unknown[][]) {
    let call = 0;
    const all = jest.fn().mockImplementation(() => {
        const rows = rowsPerCall[call] ?? [];
        call += 1;
        return Promise.resolve(rows);
    });
    return { db: { all } as unknown as AppDatabase, all };
}

const matrixRow = {
    title: 'The Matrix [4K]',
    xtream_id: 42,
    type: 'movie',
    category_xtream_id: 7,
    playlist_id: 'playlist-1',
    playlist_name: 'My Portal',
};

describe('title-match.operations', () => {
    it('returns confident matches with playlist context', async () => {
        const { db } = createDbMock([[matrixRow]]);

        await expect(matchTitles(db, ['The Matrix'])).resolves.toEqual([
            {
                queryTitle: 'The Matrix',
                playlistId: 'playlist-1',
                playlistName: 'My Portal',
                categoryId: 7,
                xtreamId: 42,
                type: 'movie',
            },
        ]);
    });

    it('drops FTS candidates whose normalized title differs', async () => {
        const { db } = createDbMock([
            [{ ...matrixRow, title: 'The Matrix Reloaded' }],
        ]);

        await expect(matchTitles(db, ['The Matrix'])).resolves.toEqual([]);
    });

    it('skips titles that normalize to nothing usable and deduplicates', async () => {
        const { db, all } = createDbMock([[matrixRow]]);

        await matchTitles(db, ['', '  ', 'The Matrix', 'The Matrix']);
        expect(all).toHaveBeenCalledTimes(1);
    });

    it('survives a failing FTS query for one title', async () => {
        let call = 0;
        const all = jest.fn().mockImplementation(() => {
            call += 1;
            return call === 1
                ? Promise.reject(new Error('fts syntax'))
                : Promise.resolve([matrixRow]);
        });
        const db = { all } as unknown as AppDatabase;

        const matches = await matchTitles(db, ['Weird "Title"', 'The Matrix']);
        expect(matches).toHaveLength(1);
        expect(matches[0].queryTitle).toBe('The Matrix');
    });
});

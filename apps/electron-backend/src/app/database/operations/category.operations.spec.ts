import type { AppDatabase } from '../database.types';
import { saveCategories } from './category.operations';

function createDbMock(existingCount = 0) {
    const existingRows =
        existingCount > 0
            ? Array.from({ length: existingCount }, (_value, index) => ({
                  id: index + 1,
                  xtreamId: index + 1,
              }))
            : [];
    const where = jest.fn().mockResolvedValue(existingRows);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const run = jest.fn();
    const onConflictDoUpdate = jest.fn().mockReturnValue({ run });
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const deleteWhere = jest.fn().mockReturnValue({ run });
    const deleteFn = jest.fn().mockReturnValue({ where: deleteWhere });
    const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
        callback({ delete: deleteFn, insert })
    );

    return {
        db: {
            select,
            insert,
            transaction,
        } as unknown as AppDatabase,
        insert,
        values,
        onConflictDoUpdate,
        deleteFn,
        deleteWhere,
        select,
        from,
        where,
    };
}

describe('category.operations', () => {
    it('restores hidden categories when Xtream API category IDs are strings', async () => {
        const { db, values, insert } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [
                { category_name: 'News', category_id: '101' },
                { category_name: 'Sports', category_id: '102' },
            ],
            'live',
            [102]
        );

        expect(insert).toHaveBeenCalled();
        expect(values).toHaveBeenNthCalledWith(1, {
            playlistId: 'playlist-1',
            name: 'News',
            type: 'live',
            xtreamId: 101,
            hidden: false,
        });
        expect(values).toHaveBeenNthCalledWith(2, {
            playlistId: 'playlist-1',
            name: 'Sports',
            type: 'live',
            xtreamId: 102,
            hidden: true,
        });
    });

    it('preserves existing category visibility when no restore list is provided', async () => {
        const { db, onConflictDoUpdate } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [
                {
                    category_name: 'News',
                    category_id: '101',
                },
            ],
            'live'
        );

        expect(onConflictDoUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                set: {
                    name: 'News',
                },
            })
        );
    });

    it('prunes categories that disappeared from the provider catalog', async () => {
        const { db, deleteFn, deleteWhere } = createDbMock(2);

        await saveCategories(
            db,
            'playlist-1',
            [{ category_name: 'Sports', category_id: '2' }],
            'live'
        );

        expect(deleteFn).toHaveBeenCalled();
        expect(deleteWhere).toHaveBeenCalled();
    });

    it('skips categories whose Xtream IDs are not numeric', async () => {
        const { db, values } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [
                { category_name: 'Valid', category_id: '201' },
                { category_name: 'Broken', category_id: 'not-a-number' },
            ],
            'movies',
            [201]
        );

        expect(values).toHaveBeenCalledTimes(1);
        expect(values).toHaveBeenCalledWith({
            playlistId: 'playlist-1',
            name: 'Valid',
            type: 'movies',
            xtreamId: 201,
            hidden: true,
        });
    });

    it('repairs mojibake in category names before saving', async () => {
        const { db, values } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [{ category_name: 'IT - NovitÃ  e qualitÃ ', category_id: '301' }],
            'movies'
        );

        expect(values).toHaveBeenCalledWith({
            playlistId: 'playlist-1',
            name: 'IT - Novità e qualità',
            type: 'movies',
            xtreamId: 301,
            hidden: false,
        });
    });

    it('does not insert categories when all Xtream IDs are invalid', async () => {
        const { db, insert } = createDbMock();

        await saveCategories(
            db,
            'playlist-1',
            [{ category_name: 'Broken', category_id: 'not-a-number' }],
            'series',
            [301]
        );

        expect(insert).not.toHaveBeenCalled();
    });
});

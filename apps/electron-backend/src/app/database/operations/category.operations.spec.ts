import type { AppDatabase } from '../database.types';
import * as schema from '@iptvnator/shared/database/schema';
import { getCategories, saveCategories } from './category.operations';

function createDbMock(existingCount = 0) {
    const where = jest.fn().mockResolvedValue([{ count: existingCount }]);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    const insert = jest.fn().mockReturnValue({ values });

    return {
        db: {
            select,
            insert,
        } as unknown as AppDatabase,
        insert,
        values,
        onConflictDoNothing,
        select,
        from,
        where,
    };
}

describe('category.operations', () => {
    it('reads visible categories in insertion order to preserve server sorting', async () => {
        const orderBy = jest.fn().mockResolvedValue([]);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await getCategories(db, 'playlist-1', 'live');

        expect(orderBy).toHaveBeenCalledWith(schema.categories.id);
    });

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
        expect(values).toHaveBeenCalledWith([
            {
                playlistId: 'playlist-1',
                name: 'News',
                type: 'live',
                xtreamId: 101,
                hidden: false,
            },
            {
                playlistId: 'playlist-1',
                name: 'Sports',
                type: 'live',
                xtreamId: 102,
                hidden: true,
            },
        ]);
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

        expect(values).toHaveBeenCalledWith([
            {
                playlistId: 'playlist-1',
                name: 'Valid',
                type: 'movies',
                xtreamId: 201,
                hidden: true,
            },
        ]);
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

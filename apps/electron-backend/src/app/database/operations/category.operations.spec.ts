import type { AppDatabase } from '../database.types';
import * as schema from '@iptvnator/shared/database/schema';
import {
    getAllCategories,
    getCategories,
    saveCategories,
    setCategoryLocks,
} from './category.operations';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { setParentalLockActive } from '../parental-lock-state';

function renderSql(query: SQL): string {
    return new SQLiteSyncDialect().sqlToQuery(query).sql;
}

// Renderer consumers (XCategoryFromDb/XtreamCategoryFromDb) expect category
// rows in this snake_case wire shape. A bare select() would return Drizzle's
// camelCase property names and silently break the playlist backup
// export/restore (issue #1017).
const categoryWireShape = {
    id: schema.categories.id,
    playlist_id: schema.categories.playlistId,
    name: schema.categories.name,
    type: schema.categories.type,
    xtream_id: schema.categories.xtreamId,
    hidden: schema.categories.hidden,
    locked: schema.categories.locked,
};

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
        expect(select).toHaveBeenCalledWith(categoryWireShape);
    });

    it('projects all categories to the snake_case wire shape', async () => {
        const orderBy = jest.fn().mockResolvedValue([]);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await getAllCategories(db, 'playlist-1', 'movies');

        expect(select).toHaveBeenCalledWith(categoryWireShape);
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
                locked: false,
            },
            {
                playlistId: 'playlist-1',
                name: 'Sports',
                type: 'live',
                xtreamId: 102,
                hidden: true,
                locked: false,
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
                locked: false,
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

describe('category.operations parental lock', () => {
    afterEach(() => {
        setParentalLockActive(false);
    });

    function createReadDb() {
        const orderBy = jest.fn().mockResolvedValue([]);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        return { db: { select } as unknown as AppDatabase, where };
    }

    it('adds the locked filter to visible-category reads only while active', async () => {
        const unlocked = createReadDb();
        await getCategories(unlocked.db, 'playlist-1', 'live');
        expect(renderSql(unlocked.where.mock.calls[0][0])).not.toContain(
            '"locked"'
        );

        setParentalLockActive(true);
        const locked = createReadDb();
        await getCategories(locked.db, 'playlist-1', 'live');
        expect(renderSql(locked.where.mock.calls[0][0])).toContain(
            '"categories"."locked" = ?'
        );
    });

    it('never filters the management read, which lists locked rows by design', async () => {
        setParentalLockActive(true);
        const { db, where } = createReadDb();
        await getAllCategories(db, 'playlist-1', 'movies');
        expect(renderSql(where.mock.calls[0][0])).not.toContain('"locked"');
    });

    it('stamps locked from the caller-supplied provider ids on insert', async () => {
        const { db, values } = createDbMock(0);

        await saveCategories(
            db,
            'playlist-1',
            [
                { category_id: '1', category_name: 'Kids' },
                { category_id: '2', category_name: 'Adult' },
            ],
            'live',
            undefined,
            [2]
        );

        expect(values).toHaveBeenCalledWith([
            expect.objectContaining({ xtreamId: 1, locked: false }),
            expect.objectContaining({ xtreamId: 2, locked: true }),
        ]);
    });

    it('re-stamps one playlist/type: clears everything, then locks the listed ids', async () => {
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        const update = jest.fn().mockReturnValue({ set });
        const db = { update } as unknown as AppDatabase;

        await setCategoryLocks(db, 'playlist-1', 'live', [5, 5, 7, 1.5]);

        expect(set).toHaveBeenNthCalledWith(1, { locked: false });
        expect(set).toHaveBeenNthCalledWith(2, { locked: true });
        const lockScope = new SQLiteSyncDialect().sqlToQuery(
            where.mock.calls[1][0]
        );
        expect(lockScope.sql).toContain('"categories"."xtream_id" in (?, ?)');
        expect(lockScope.params).toEqual(['playlist-1', 'live', 5, 7]);
    });

    it('only clears when no id is locked', async () => {
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        const update = jest.fn().mockReturnValue({ set });
        const db = { update } as unknown as AppDatabase;

        await setCategoryLocks(db, 'playlist-1', 'series', []);

        expect(set).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith({ locked: false });
    });
});

const andMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'and',
    conditions,
}));
const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));
const sqlMock = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings,
    values,
}));

jest.mock('drizzle-orm', () => ({
    and: (...conditions: unknown[]) => andMock(...conditions),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
        sqlMock(strings, ...values),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { setContentBackdropIfMissing } from './content-backdrop.operations';

function createDbMock() {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });

    return {
        db: {
            update,
        } as unknown as AppDatabase,
        set,
        update,
        where,
    };
}

describe('content-backdrop.operations', () => {
    beforeEach(() => {
        andMock.mockClear();
        eqMock.mockClear();
        sqlMock.mockClear();
    });

    it('populates the content backdrop when a non-empty url is provided', async () => {
        const { db, set, update, where } = createDbMock();

        await expect(
            setContentBackdropIfMissing(
                db,
                42,
                ' https://example.com/backdrop.jpg '
            )
        ).resolves.toEqual({ success: true });

        expect(update).toHaveBeenCalledWith(schema.content);
        expect(set).toHaveBeenCalledWith({
            backdropUrl: 'https://example.com/backdrop.jpg',
        });
        expect(eqMock).toHaveBeenCalledWith(schema.content.id, 42);
        expect(where.mock.calls[0][0].conditions).toHaveLength(2);
    });

    it('skips blank urls without touching content or recency tables', async () => {
        const { db, update } = createDbMock();

        await expect(
            setContentBackdropIfMissing(db, 42, '   ')
        ).resolves.toEqual({ success: true });

        expect(update).not.toHaveBeenCalled();
    });

    it('never updates recently viewed timestamps for backdrop-only backfill', async () => {
        const { db, update } = createDbMock();

        await setContentBackdropIfMissing(
            db,
            42,
            'https://example.com/backdrop.jpg'
        );

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(schema.content);
        expect(update).not.toHaveBeenCalledWith(
            schema.recentlyViewed as unknown as never
        );
    });
});

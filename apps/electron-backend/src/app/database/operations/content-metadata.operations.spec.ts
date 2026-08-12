const andMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'and',
    conditions,
}));
const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));
const orMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'or',
    conditions,
}));
const sqlMock = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
        kind: 'sql',
        strings,
        values,
    })
);

jest.mock('drizzle-orm', () => ({
    and: (...conditions: unknown[]) => andMock(...conditions),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    or: (...conditions: unknown[]) => orMock(...conditions),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
        sqlMock(strings, ...values),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { setContentMetadataIfMissing } from './content-metadata.operations';

function createDbMock() {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });

    return {
        db: { update } as unknown as AppDatabase,
        set,
        update,
        where,
    };
}

/** The literal SQL text of a `sql` template, with its interpolations elided */
function sqlText(value: unknown): string {
    const node = value as { strings?: TemplateStringsArray };
    return node.strings ? node.strings.join('?') : '';
}

/** The interpolated values of a `sql` template, columns excluded */
function sqlValues(value: unknown): unknown[] {
    return (value as { values: unknown[] }).values;
}

describe('content-metadata.operations', () => {
    beforeEach(() => {
        andMock.mockClear();
        eqMock.mockClear();
        orMock.mockClear();
        sqlMock.mockClear();
    });

    it('writes the whole patch in one statement', async () => {
        const { db, set, update } = createDbMock();

        await expect(
            setContentMetadataIfMissing(db, 42, {
                backdropUrl: ' https://example.com/backdrop.jpg ',
                tmdbId: 603,
                releaseYear: 1999,
                originalTitle: ' The Matrix ',
            })
        ).resolves.toEqual({ success: true });

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(schema.content);

        const written = set.mock.calls[0][0];
        expect(Object.keys(written).sort()).toEqual([
            'backdropUrl',
            'originalTitle',
            'releaseYear',
            'tmdbId',
        ]);
        // Values are trimmed by the shared normalizer before they get here
        expect(sqlValues(written.backdropUrl)).toContain(
            'https://example.com/backdrop.jpg'
        );
        expect(sqlValues(written.originalTitle)).toContain('The Matrix');
        expect(sqlValues(written.tmdbId)).toContain(603);
        expect(sqlValues(written.releaseYear)).toContain(1999);
    });

    it('preserves a column that already holds a value', async () => {
        const { db, set } = createDbMock();

        await setContentMetadataIfMissing(db, 42, {
            backdropUrl: 'https://example.com/backdrop.jpg',
            tmdbId: 603,
        });

        // One statement covers every requested column, so each assignment has
        // to defend its own column: without COALESCE, filling an empty
        // backdrop would also overwrite an id resolved earlier.
        for (const assignment of Object.values(set.mock.calls[0][0])) {
            expect(sqlText(assignment)).toContain('COALESCE');
            expect(sqlText(assignment)).toContain('NULLIF');
        }
    });

    it('only updates rows where at least one requested column is absent', async () => {
        const { db, where } = createDbMock();

        await setContentMetadataIfMissing(db, 42, {
            backdropUrl: 'https://example.com/backdrop.jpg',
            tmdbId: 603,
        });

        expect(eqMock).toHaveBeenCalledWith(schema.content.id, 42);
        const conditions = where.mock.calls[0][0].conditions;
        expect(conditions).toHaveLength(2);
        // An OR, not an AND: a row missing only the id must still be updated,
        // or the first field to arrive would block every later one forever.
        expect(orMock).toHaveBeenCalledTimes(1);
        expect(orMock.mock.calls[0]).toHaveLength(2);
    });

    it('treats an empty string as an absent text column but not an integer', async () => {
        const { db } = createDbMock();

        await setContentMetadataIfMissing(db, 42, {
            backdropUrl: 'https://example.com/backdrop.jpg',
            tmdbId: 603,
        });

        const guards = orMock.mock.calls[0].map(sqlText);
        expect(guards.some((guard) => guard.includes("= ''"))).toBe(true);
        expect(
            guards.filter((guard) => guard.includes("= ''"))
        ).toHaveLength(1);
    });

    it.each([
        ['an undefined patch', undefined],
        ['an empty patch', {}],
        ['blank strings', { backdropUrl: '   ', originalTitle: '  ' }],
        ['a non-positive id', { tmdbId: 0 }],
        ['an implausible year', { releaseYear: 12 }],
    ])('skips the write entirely for %s', async (_label, patch) => {
        const { db, update } = createDbMock();

        await expect(
            setContentMetadataIfMissing(db, 42, patch)
        ).resolves.toEqual({ success: true });

        expect(update).not.toHaveBeenCalled();
    });

    it('never touches recently viewed while backfilling metadata', async () => {
        const { db, update } = createDbMock();

        await setContentMetadataIfMissing(db, 42, {
            backdropUrl: 'https://example.com/backdrop.jpg',
        });

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(schema.content);
        expect(update).not.toHaveBeenCalledWith(
            schema.recentlyViewed as unknown as never
        );
    });
});

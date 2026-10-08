import { and, eq, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import * as schema from '@iptvnator/shared/database/schema';

function renderSql(query: SQL): string {
    return new SQLiteSyncDialect().sqlToQuery(query).sql;
}
import {
    isParentalLockActive,
    setParentalLockActive,
    unlockedCategoryCondition,
    unlockedCategorySql,
} from './parental-lock-state';

describe('parental-lock-state', () => {
    afterEach(() => {
        setParentalLockActive(false);
    });

    it('starts unlocked and contributes nothing to queries', () => {
        expect(isParentalLockActive()).toBe(false);
        expect(unlockedCategoryCondition()).toBeUndefined();
        expect(renderSql(unlockedCategorySql())).toBe('');
        // `and()` must tolerate the undefined condition so callers can add
        // it unconditionally.
        expect(
            and(eq(schema.categories.type, 'live'), undefined)
        ).toBeDefined();
    });

    it('filters on categories.locked while active', () => {
        setParentalLockActive(true);

        expect(isParentalLockActive()).toBe(true);
        expect(unlockedCategoryCondition()).toEqual(
            eq(schema.categories.locked, false)
        );
        expect(renderSql(unlockedCategorySql())).toContain(
            'AND cat.locked = 0'
        );
    });

    it('coerces anything but true to inactive', () => {
        setParentalLockActive('yes' as unknown as boolean);
        expect(isParentalLockActive()).toBe(false);
    });
});

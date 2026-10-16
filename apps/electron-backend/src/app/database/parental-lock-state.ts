import { eq, sql, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';

/**
 * Process-wide parental lock enforcement flag for the SQLite worker.
 *
 * While active, every content-returning read appends "category is not
 * locked", so a surface added later is withheld by default instead of
 * leaking. The value arrives from the main process: seeded through
 * `workerData` when the worker is (re)started and updated by the
 * `DB_SET_PARENTAL_LOCK_STATE` request. It is deliberately not read from
 * settings inside the worker, which has no access to the renderer's
 * IndexedDB or to electron-conf.
 */
let parentalLockActive = false;

export function setParentalLockActive(active: boolean): void {
    parentalLockActive = active === true;
}

export function isParentalLockActive(): boolean {
    return parentalLockActive;
}

/**
 * Drizzle condition for query-builder reads joined on `categories`;
 * `undefined` while unlocked so `and(...)` ignores it.
 */
export function unlockedCategoryCondition(): SQL | undefined {
    return parentalLockActive ? eq(schema.categories.locked, false) : undefined;
}

/**
 * Raw fragment for `sql` template reads that alias the categories table as
 * `cat`; empty while unlocked.
 */
export function unlockedCategorySql(): SQL {
    return parentalLockActive ? sql`AND cat.locked = 0` : sql``;
}

/**
 * Main-process copy of the parental lock enforcement flag.
 *
 * The renderer owns the unlock decision and reports it over
 * `PARENTAL_LOCK_SET_STATE`; this module remembers the latest value so the
 * database worker can be seeded with it whenever it is (re)started, and so a
 * renderer reload or crash can fall back to "locked while the feature is on"
 * without waiting for a page that may never come back.
 */
let parentalLockActive = false;

export function getParentalLockActive(): boolean {
    return parentalLockActive;
}

export function setParentalLockActiveState(active: boolean): void {
    parentalLockActive = active === true;
}

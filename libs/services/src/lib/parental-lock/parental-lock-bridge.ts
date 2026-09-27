import { signal } from '@angular/core';

/**
 * Electron bridge calls of the parental lock. Both are no-ops in the PWA,
 * where there is no main process to inform.
 */

/**
 * Tells the SQLite worker (through main) whether locked rows are withheld.
 * Resolves false when the IPC rejected: the worker keeps its previous
 * state, so the caller must not trust worker reads while locked.
 */
export async function syncParentalLockStateToMainProcess(
    active: boolean
): Promise<boolean> {
    const bridge = window.electron;
    if (typeof bridge?.setParentalLockState !== 'function') {
        return true;
    }
    try {
        await bridge.setParentalLockState(active);
        return true;
    } catch (error) {
        console.error('Failed to sync the parental lock state.', error);
        return false;
    }
}

/**
 * Mirrors the feature switch into electron-conf so a reloaded renderer and a
 * restarted worker start locked while the feature is on. Resolves false
 * when the main process could not persist it — the caller must then not
 * report the switch as changed, or a reload would start from the old
 * mirror. True in the PWA, which has no mirror.
 */
export async function mirrorParentalLockEnabledSetting(
    enabled: boolean
): Promise<boolean> {
    const bridge = window.electron;
    if (typeof bridge?.updateSettings !== 'function') {
        return true;
    }
    try {
        await bridge.updateSettings({ parentalLockEnabled: enabled });
        return true;
    } catch (error) {
        console.error('Failed to mirror the parental lock switch.', error);
        return false;
    }
}

/**
 * Electron reads Xtream through the SQLite worker, but the bridge lacks the
 * lock-state or index IPC (a partial or older preload): the worker cannot
 * withhold locked rows, so a locked session withholds everything.
 */
export function isParentalLockWorkerFilterMissing(runtime: {
    supportsXtreamSqliteDataSource: boolean;
    supportsParentalLockSqliteFilter: boolean;
}): boolean {
    const missing =
        runtime.supportsXtreamSqliteDataSource &&
        !runtime.supportsParentalLockSqliteFilter;
    if (missing) {
        console.error(
            'The parental lock bridge is incomplete; locked sessions withhold every category.'
        );
    }
    return missing;
}

/**
 * Whether the SQLite worker learned the current lock state. A rejected
 * sync leaves the worker in its previous state, so a locked session must
 * not trust worker reads until a later sync succeeds.
 */
export class ParentalLockWorkerSync {
    readonly failed = signal(false);
    /** Bumps whenever `failed` changes; part of the lock version. */
    readonly changes = signal(0);

    /**
     * Syncs `active`. A sync superseded by a newer transition (`current()`
     * no longer equals `active`) changes nothing.
     */
    async sync(active: boolean, current: () => boolean): Promise<void> {
        const failed = !(await syncParentalLockStateToMainProcess(active));
        if (current() !== active || this.failed() === failed) {
            return;
        }
        this.failed.set(failed);
        this.changes.update((value) => value + 1);
    }
}

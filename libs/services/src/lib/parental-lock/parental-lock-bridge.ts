/**
 * Electron bridge calls of the parental lock. Both are no-ops in the PWA,
 * where there is no main process to inform.
 */

/** Tells the SQLite worker (through main) whether locked rows are withheld. */
export function syncParentalLockStateToMainProcess(active: boolean): void {
    const bridge = window.electron;
    if (typeof bridge?.setParentalLockState !== 'function') {
        return;
    }
    void bridge.setParentalLockState(active).catch((error) => {
        console.error('Failed to sync the parental lock state.', error);
    });
}

/**
 * Mirrors the feature switch into electron-conf so a reloaded renderer and a
 * restarted worker start locked while the feature is on.
 */
export function mirrorParentalLockEnabledSetting(enabled: boolean): void {
    const bridge = window.electron;
    if (typeof bridge?.updateSettings !== 'function') {
        return;
    }
    void bridge
        .updateSettings({ parentalLockEnabled: enabled })
        .catch(() => undefined);
}

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

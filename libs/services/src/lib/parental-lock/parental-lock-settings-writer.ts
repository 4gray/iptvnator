import { normalizeParentalLockRelockMinutes } from '@iptvnator/shared/interfaces';
import { SettingsStore } from '../settings-store.service';
import { mirrorParentalLockEnabledSetting } from './parental-lock-bridge';

type SettingsWriter = Pick<
    InstanceType<typeof SettingsStore>,
    'updateSettings' | 'loadSettings'
> & {
    storageFailure?: () => 'load' | 'save' | null;
    parentalLockEnabled?: () => boolean | undefined;
};

/**
 * `updateSettings` writes the WHOLE settings object. After a failed startup
 * read that object is the defaults, so a parental-lock write would replace
 * the user's persisted player, portal and UI preferences. The read is
 * retried first (a transient failure recovers here), and the write is
 * refused while settings stay unreadable.
 */
export async function ensureParentalLockSettingsReadable(
    settings: SettingsWriter
): Promise<boolean> {
    if (settings.storageFailure?.() !== 'load') {
        return true;
    }
    await settings.loadSettings();
    return settings.storageFailure?.() !== 'load';
}

/**
 * Persists the feature switch. `updateSettings` patches the in-memory value
 * before the write; on a failed write that patch is undone (the second write
 * fails the same way and is ignored), so the toggle cannot show a state the
 * next launch will not have. The Electron mirror is written after the
 * settings and undoes them the same way when it fails: a reloaded renderer
 * and a restarted worker start from the mirror.
 */
export async function persistParentalLockEnabled(
    settings: SettingsWriter,
    enabled: boolean
): Promise<boolean> {
    if (!(await ensureParentalLockSettingsReadable(settings))) {
        return false;
    }
    // Read AFTER the retry, as for the relock timeout: a recovered read may
    // already hold `enabled` (e.g. disable() entered while the unknown
    // switch followed the stored PIN), and undoing to the inverse would
    // then write the opposite of what was persisted.
    const previous = settings.parentalLockEnabled?.() ?? !enabled;
    const undo = () =>
        settings
            .updateSettings({ parentalLockEnabled: previous })
            .catch(() => undefined);
    try {
        await settings.updateSettings({ parentalLockEnabled: enabled });
    } catch (error) {
        console.error('Failed to persist the parental lock switch.', error);
        await undo();
        return false;
    }
    if (!(await mirrorParentalLockEnabledSetting(enabled))) {
        await undo();
        return false;
    }
    return true;
}

/**
 * False when the value could not be persisted; the in-memory patch is undone
 * so the timer on screen never differs from the one the next launch uses.
 */
export async function persistParentalLockRelockMinutes(
    settings: SettingsWriter,
    minutes: number,
    readCurrent: () => number
): Promise<boolean> {
    if (!(await ensureParentalLockSettingsReadable(settings))) {
        return false;
    }
    // Read AFTER the retry: a recovered read replaces the defaults, and a
    // rollback to the pre-retry value would write the default back.
    const previous = readCurrent();
    try {
        await settings.updateSettings({
            parentalLockRelockMinutes:
                normalizeParentalLockRelockMinutes(minutes),
        });
        return true;
    } catch (error) {
        console.error('Failed to persist the relock timeout.', error);
        await settings
            .updateSettings({
                parentalLockRelockMinutes:
                    normalizeParentalLockRelockMinutes(previous),
            })
            .catch(() => undefined);
        return false;
    }
}

import { Injectable } from '@angular/core';
import { SETTINGS_RESTART_CONTROLS } from './settings-change-tracking';

/**
 * Values of the restart-only settings the running app started with. Root
 * provided on purpose: the settings page (and its form facade) is recreated
 * every time it opens, but what the app launched with does not change until
 * it restarts, so the restart notice must compare against one app-lifetime
 * record.
 */
@Injectable({ providedIn: 'root' })
export class SettingsLaunchValuesService {
    private values: Record<string, unknown> | null = null;

    /** Records the stored values once, on the first settings open. */
    captureOnce(read: (control: string) => unknown): void {
        if (this.values) return;
        const values: Record<string, unknown> = {};
        for (const control of Object.keys(SETTINGS_RESTART_CONTROLS)) {
            values[control] = read(control);
        }
        this.values = values;
    }

    /**
     * What the running app actually uses when that differs from the stored
     * value (a frame-copy opt-in the engine could not honour).
     */
    set(control: string, value: unknown): void {
        if (!(control in SETTINGS_RESTART_CONTROLS)) return;
        this.values = { ...(this.values ?? {}), [control]: value };
    }

    get(): Readonly<Record<string, unknown>> {
        return this.values ?? {};
    }
}

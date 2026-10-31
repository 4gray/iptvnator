import { signal } from '@angular/core';
import { SettingsActivitySectionComponent } from './settings-activity-section.component';
import type { ActivitySyncRuntime } from '../services/activity-sync-runtime';

describe('activity consent checkbox', () => {
    it('restores the unchecked state after a failed enable attempt', async () => {
        const component = new SettingsActivitySectionComponent();
        component.runtime.set({
            enabled: signal(false),
            setEnabled: async (_enabled: boolean): Promise<void> => {
                return;
            },
        } as ActivitySyncRuntime);
        const change = { checked: true, source: { checked: true } };
        await component.setActivityEnabled(change);
        expect(change.source.checked).toBe(false);
    });
    it('reflects the consent actually stored after a successful toggle', async () => {
        const component = new SettingsActivitySectionComponent();
        const enabled = signal(false);
        component.runtime.set({
            enabled,
            setEnabled: async (value) => {
                enabled.set(value);
            },
        } as ActivitySyncRuntime);
        const change = { checked: true, source: { checked: false } };
        await component.setActivityEnabled(change);
        expect(change.source.checked).toBe(true);
    });
    it('keeps the checkbox truthful when storage rejects the toggle', async () => {
        const component = new SettingsActivitySectionComponent();
        component.runtime.set({
            enabled: signal(false),
            setEnabled: async (_enabled: boolean): Promise<void> => {
                throw new Error('storage unavailable');
            },
        } as ActivitySyncRuntime);
        const change = { checked: true, source: { checked: true } };
        await component.setActivityEnabled(change);
        expect(change.source.checked).toBe(false);
        expect(component.failed()).toBe(true);
    });
});

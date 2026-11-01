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

describe('activity settings actions', () => {
    function fixture() {
        const component = new SettingsActivitySectionComponent();
        const position = {
            contentType: 'vod' as const,
            contentXtreamId: 42,
            positionSeconds: 25,
        };
        const preview = [{ sourceId: 'synthetic-source', items: [position] }];
        const runtime = {
            busy: signal(false),
            previewImport: jest.fn(async () => preview),
            importPositions: jest.fn(async (_value: typeof preview) => 2),
            refresh: jest.fn(async () => undefined),
            resolve: jest.fn(
                async (_address: unknown, _local: boolean) => undefined
            ),
            parked: jest.fn(async (_send: boolean) => undefined),
        };
        component.runtime.set(runtime as unknown as ActivitySyncRuntime);
        return { component, runtime, preview };
    }

    it('previews and counts local activity without uploading it, then reports unresolved imports', async () => {
        const { component, runtime, preview } = fixture();
        expect(component.count()).toBe(0);
        await component.previewImport();
        expect(component.preview()).toEqual(preview);
        expect(component.count()).toBe(1);
        expect(runtime.importPositions).not.toHaveBeenCalled();
        await component.importPositions();
        expect(runtime.importPositions).toHaveBeenCalledWith(preview);
        expect(component.preview()).toBeNull();
        expect(component.unresolved()).toBe(2);
        expect(component.busy()).toBe(false);
    });

    it('retains a reviewed selection when preview or import fails and permits retry', async () => {
        const { component, runtime, preview } = fixture();
        component.preview.set(preview);
        runtime.previewImport.mockRejectedValueOnce(
            new Error('Synthetic unavailable storage')
        );
        await component.previewImport();
        expect(component.failed()).toBe(true);
        expect(component.preview()).toEqual(preview);
        runtime.importPositions.mockRejectedValueOnce(
            new Error('Synthetic unavailable server')
        );
        await component.importPositions();
        expect(component.failed()).toBe(true);
        expect(component.preview()).toEqual(preview);
        await component.importPositions();
        expect(component.failed()).toBe(false);
        expect(component.preview()).toBeNull();
    });

    it('blocks duplicate preview/import actions while their first request is pending', async () => {
        const { component, runtime, preview } = fixture();
        let release!: (value: typeof preview) => void;
        runtime.previewImport.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
        const pending = component.previewImport();
        await component.previewImport();
        await component.importPositions();
        expect(runtime.previewImport).toHaveBeenCalledTimes(1);
        expect(runtime.importPositions).not.toHaveBeenCalled();
        release(preview);
        await pending;
        expect(component.busy()).toBe(false);
    });

    it('serializes refresh, conflict choices and parked-action decisions and surfaces failures', async () => {
        const { component, runtime } = fixture();
        const address = {
            instanceId: 'synthetic-nas',
            scope: 'shared' as const,
            sourceId: 'synthetic-source',
            sourceIncarnation: 'synthetic-generation',
            content: {
                provider: 'xtream' as const,
                kind: 'vod' as const,
                id: '42',
            },
        };
        runtime.busy.set(true);
        await component.refresh();
        expect(runtime.refresh).not.toHaveBeenCalled();
        runtime.busy.set(false);
        runtime.refresh.mockRejectedValueOnce(
            new Error('Synthetic offline request')
        );
        await component.refresh();
        expect(component.failed()).toBe(true);
        expect(component.busy()).toBe(false);
        await component.resolve(address, true);
        await component.parked(false);
        expect(runtime.resolve).toHaveBeenCalledWith(address, true);
        expect(runtime.parked).toHaveBeenCalledWith(false);
        expect(component.failed()).toBe(false);
        component.runtime.set(null);
        await component.refresh();
        expect(runtime.refresh).toHaveBeenCalledTimes(1);
    });
});

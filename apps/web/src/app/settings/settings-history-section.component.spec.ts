import { EnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsHistorySectionComponent } from './settings-history-section.component';
import {
    HistorySyncRuntime,
    type HistoryPreview,
} from '../services/history-sync-runtime';
import { loadHistoryRuntime } from '../services/history-sync.providers';

async function fixture() {
    const preview: HistoryPreview = {
        instanceId: 'synthetic-nas',
        generation: 'synthetic-consent',
        unresolved: 1,
        sources: [
            {
                scope: {
                    instanceId: 'synthetic-nas',
                    sourceId: 'synthetic-source',
                    sourceIncarnation: 'first',
                    provider: 'xtream',
                },
                items: [
                    {
                        reference: {
                            provider: 'xtream',
                            kind: 'movie',
                            id: '42',
                        },
                        viewedAt: 100,
                    },
                ],
            },
        ],
    };
    const enabled = signal(false);
    const runtime = {
        enabled,
        setEnabled: jest.fn(async (value: boolean) => {
            enabled.set(value);
        }),
        previewImport: jest.fn(async () => preview),
        importHistory: jest.fn(async (_preview: HistoryPreview) => undefined),
        parked: jest.fn(async (_send: boolean) => undefined),
        refresh: jest.fn(async (): Promise<void> => undefined),
    };
    TestBed.configureTestingModule({
        providers: [{ provide: HistorySyncRuntime, useValue: runtime }],
    });
    const component = TestBed.runInInjectionContext(
        () => new SettingsHistorySectionComponent()
    );
    await loadHistoryRuntime(TestBed.inject(EnvironmentInjector));
    await Promise.resolve();
    return { component, runtime, preview };
}
afterEach(() => TestBed.resetTestingModule());

it('reflects persisted consent after successful or failed checkbox actions', async () => {
    const f = await fixture();
    expect(f.component.runtime()).toBe(f.runtime);
    f.runtime.setEnabled.mockRejectedValueOnce(
        new Error('Synthetic storage failure')
    );
    const change = { checked: true, source: { checked: true } };
    await f.component.toggle(change);
    expect(change.source.checked).toBe(false);
    expect(f.component.failed()).toBe(true);
    await f.component.toggle(change);
    expect(change.source.checked).toBe(true);
    expect(f.component.failed()).toBe(false);
    expect(f.component.preview()).toBeNull();
});

it('requires explicit import, retaining the reviewed preview after a failure', async () => {
    const f = await fixture();
    expect(f.component.count()).toBe(0);
    await f.component.previewImport();
    expect(f.component.count()).toBe(1);
    expect(f.runtime.importHistory).not.toHaveBeenCalled();
    f.runtime.importHistory.mockRejectedValueOnce(
        new Error('Synthetic offline')
    );
    await f.component.importHistory();
    expect(f.component.preview()).toEqual(f.preview);
    expect(f.component.failed()).toBe(true);
    await f.component.importHistory();
    expect(f.component.preview()).toBeNull();
    expect(f.component.failed()).toBe(false);
    expect(f.runtime.importHistory).toHaveBeenLastCalledWith(f.preview);
});

it('does not submit overlapping queue decisions or actions without a loaded runtime', async () => {
    const f = await fixture();
    f.component.runtime.set(null);
    await f.component.refresh();
    expect(f.runtime.refresh).not.toHaveBeenCalled();
    f.component.runtime.set(f.runtime as unknown as HistorySyncRuntime);
    let release!: () => void;
    f.runtime.refresh.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                release = resolve;
            })
    );
    const refreshing = f.component.refresh();
    expect(f.component.busy()).toBe(true);
    await f.component.parked(true);
    expect(f.runtime.parked).not.toHaveBeenCalled();
    release();
    await refreshing;
    await f.component.parked(false);
    await f.component.parked(true);
    expect(f.runtime.parked.mock.calls).toEqual([[false], [true]]);
    expect(f.component.busy()).toBe(false);
});

it('reports lazy runtime initialization failures', async () => {
    TestBed.configureTestingModule({
        providers: [
            {
                provide: HistorySyncRuntime,
                useFactory: () => {
                    throw new Error('Synthetic unavailable runtime');
                },
            },
        ],
    });
    const component = TestBed.runInInjectionContext(
        () => new SettingsHistorySectionComponent()
    );
    await import('../services/history-sync-runtime');
    await Promise.resolve();
    expect(component.failed()).toBe(true);
    expect(component.runtime()).toBeNull();
});

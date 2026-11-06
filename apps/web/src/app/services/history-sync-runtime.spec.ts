import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    favoriteSourceRetirementKey,
    retireFavoriteSourceContext,
} from '@iptvnator/services/favorites-sync';
import { historyScopeKey } from '@iptvnator/shared/interfaces/history-sync';
import type {
    XtreamPlaylistBackupEntry,
    PlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    historyPlaylistBridgeFactory,
    invokeHistory,
} from './history-sync.providers';
import {
    historyConsent,
    historyInstance,
    historyRuntimeFixture,
} from './test-stubs/history-runtime-fixture.stub';

describe('history consent, recovery and user actions', () => {
    const original = window.electron;
    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
    });
    afterEach(async () => {
        TestBed.resetTestingModule();
        jest.restoreAllMocks();
        jest.clearAllTimers();
        jest.useRealTimers();
        window.electron = original;
        localStorage.clear();
        await prepareSourceConnection();
    });

    it.each([true, false])(
        'enables without uploading archives and imports only a reviewed preview, native=%s',
        async (native) => {
            const f = await historyRuntimeFixture(native);
            expect(f.runtime.stateKey()).toBe('HISTORY_SYNC.STATE_disabled');
            await f.runtime.refresh();
            expect(f.refresh).not.toHaveBeenCalled();
            await f.runtime.setEnabled(true);
            expect(f.runtime.enabled()).toBe(true);
            expect(f.runtime.state()).toBe('ready');
            expect(
                f.request.mock.calls.some(
                    ([r]) => r.operation === 'history-apply'
                )
            ).toBe(false);
            const preview = await f.runtime.previewImport();
            expect(
                preview.sources.map((source) => source.items.length)
            ).toEqual([1, 1]);
            expect(f.raw.getRecentItems).toHaveBeenLastCalledWith(
                f.portal._id,
                ...(native ? [{ all: true }] : [])
            );
            await f.runtime.importHistory(preview);
            expect(f.runtime.pending()).toBe(0);
            expect(
                f.request.mock.calls.filter(
                    ([r]) => r.operation === 'history-apply'
                )
            ).toHaveLength(2);
            expect(
                (await f.runtime.project(f.playlist)).recentlyViewed
            ).toHaveLength(1);
            expect(await f.runtime.project(null as never)).toBeNull();
            expect(
                (
                    await f.runtime.project({
                        ...f.playlist,
                        playlist: undefined,
                    })
                ).recentlyViewed
            ).toHaveLength(1);
            const rows = await f.runtime.invoke(
                f.raw as never,
                'getRecentItems',
                [f.portal._id]
            );
            expect(rows).toEqual([expect.objectContaining({ xtream_id: 41 })]);
            const entry = {
                portalType: 'xtream',
                userState: { recentlyViewed: [] },
            } as unknown as XtreamPlaylistBackupEntry;
            expect(
                (await f.runtime.exportHistory(f.portal, entry)).userState
                    .recentlyViewed
            ).toHaveLength(1);
            const before = f.request.mock.calls.length;
            await f.runtime.backupRestorer()(f.portal._id, entry);
            expect(
                await f.runtime.invoke(f.raw as never, 'getRecentItems', [
                    f.portal._id,
                ])
            ).toEqual([]);
            const m3uEntry = {
                portalType: 'm3u',
                userState: { recentlyViewed: [] },
            } as unknown as PlaylistBackupEntry;
            expect(
                (await f.runtime.exportHistory(f.playlist, m3uEntry)).userState
                    .recentlyViewed
            ).toHaveLength(1);
            await f.runtime.backupRestorer()(f.playlist._id, m3uEntry);
            expect(
                (await f.runtime.project(f.playlist)).recentlyViewed
            ).toEqual([]);
            expect(f.request).toHaveBeenCalledTimes(before);
            await f.runtime.setEnabled(false);
            expect(f.runtime.enabled()).toBe(false);
            expect(f.runtime.state()).toBe('disabled');
            expect(f.dispatch).toHaveBeenCalled();
        }
    );

    it.each([true, false])(
        'restores an unchanged source after creating or retiring another source, native=%s',
        async (native) => {
            const f = await historyRuntimeFixture(native);
            await f.runtime.setEnabled(true);
            await f.runtime.importHistory(await f.runtime.previewImport());
            const restore = f.runtime.backupRestorer();
            const requests = f.request.mock.calls.length;
            const base = f.records.get(historyScopeKey(f.scopes[1]))!.base;
            retireFavoriteSourceContext(
                historyInstance,
                'synthetic-new-source'
            );
            f.raw.getRecentItems.mockResolvedValue([]);
            await restore(f.portal._id, {
                portalType: 'xtream',
                userState: { recentlyViewed: [] },
            } as unknown as XtreamPlaylistBackupEntry);
            expect(
                await f.runtime.invoke(f.raw as never, 'getRecentItems', [
                    f.portal._id,
                ])
            ).toEqual([]);
            expect(f.records.get(historyScopeKey(f.scopes[1]))!.base).toEqual(
                base
            );
            retireFavoriteSourceContext(historyInstance, f.portal._id);
            await restore(f.playlist._id, {
                portalType: 'm3u',
                userState: { recentlyViewed: [] },
            } as unknown as PlaylistBackupEntry);
            expect(
                (await f.runtime.project(f.playlist)).recentlyViewed
            ).toEqual([]);
            expect(f.request).toHaveBeenCalledTimes(requests);
        }
    );

    it.each(['source', 'consent', 'profile'] as const)(
        'rejects a renewed backup restorer when its %s changes',
        async (change) => {
            const f = await historyRuntimeFixture();
            await f.runtime.setEnabled(true);
            const restore = f.runtime.backupRestorer();
            const records = JSON.stringify([...f.records]);
            retireFavoriteSourceContext(
                historyInstance,
                'synthetic-new-source'
            );
            if (change === 'source')
                retireFavoriteSourceContext(historyInstance, f.portal._id);
            else if (change === 'consent')
                localStorage.setItem(
                    historyConsent,
                    JSON.stringify({
                        ...JSON.parse(localStorage.getItem(historyConsent)!),
                        generation: 'synthetic-replacement',
                    })
                );
            else {
                const next = 'synthetic-other-instance';
                localStorage.setItem(
                    'iptvnator:source-server',
                    JSON.stringify({
                        apiUrl: 'https://history.example/api',
                        instanceId: next,
                    })
                );
                localStorage.setItem(
                    `iptvnator-server:${next}:history-consent-v1`,
                    localStorage.getItem(historyConsent)!
                );
                localStorage.setItem(
                    `iptvnator-server:${next}:history-contexts-v1`,
                    JSON.stringify(
                        f.scopes.map((scope) => ({
                            ...scope,
                            instanceId: next,
                        }))
                    )
                );
                await prepareSourceConnection();
            }
            await expect(
                restore(f.portal._id, {
                    portalType: 'xtream',
                    userState: { recentlyViewed: [] },
                } as unknown as XtreamPlaylistBackupEntry)
            ).rejects.toThrow();
            expect(JSON.stringify([...f.records])).toBe(records);
        }
    );

    it.each([false, true])(
        'requires an explicit decision for earlier-consent work, send=%s',
        async (send) => {
            const f = await historyRuntimeFixture();
            await f.runtime.setEnabled(true);
            f.offline(true);
            await f.runtime.mutate(f.playlist, {
                kind: 'touch',
                item: f.recent,
            });
            await f.runtime.refresh();
            expect(f.runtime.state()).toBe('offline');
            await f.runtime.setEnabled(false);
            expect(f.runtime.pending()).toBe(1);
            f.offline(false);
            const before = f.request.mock.calls.filter(
                ([r]) => r.operation === 'history-apply'
            ).length;
            await f.runtime.setEnabled(true);
            expect(f.runtime.parkedCount()).toBe(1);
            expect(
                f.request.mock.calls.filter(
                    ([r]) => r.operation === 'history-apply'
                )
            ).toHaveLength(before);
            await f.runtime.parked(send);
            expect(f.runtime.pending()).toBe(0);
            expect(f.runtime.parkedCount()).toBe(0);
            expect(f.runtime.localCount()).toBe(send ? 0 : 1);
            expect(
                f.request.mock.calls.filter(
                    ([r]) => r.operation === 'history-apply'
                )
            ).toHaveLength(before + (send ? 1 : 0));
            expect(
                (await f.runtime.project(f.playlist)).recentlyViewed
            ).toHaveLength(1);
        }
    );

    it.each(
        [true, false].flatMap((native) =>
            (['unrelated', 'target', 'profile'] as const).map(
                (change) => [native, change] as const
            )
        )
    )(
        'retains a confirmed watch only for its original source, native=%s change=%s',
        async (native, change) => {
            const f = await historyRuntimeFixture(native);
            await f.runtime.setEnabled(true);
            f.offline(true);
            let release!: () => void;
            let started!: () => void;
            const entered = new Promise<void>((resolve) => (started = resolve));
            const paused = new Promise<void>((resolve) => (release = resolve));
            const lookup = f.raw.getContentByXtreamId.getMockImplementation()!;
            f.raw.getContentByXtreamId.mockImplementationOnce(async (id) => {
                started();
                await paused;
                return lookup(id);
            });
            const watch = f.runtime.invoke(f.raw as never, 'addRecentItem', [
                { id: 41, type: 'movie', providerId: 41 },
                f.portal._id,
            ]);
            const result = watch.then(
                () => true,
                () => false
            );
            await entered;
            if (change === 'profile') {
                localStorage.setItem(
                    'iptvnator:source-server',
                    JSON.stringify({
                        apiUrl: 'https://other.example/api',
                        instanceId: 'synthetic-other-instance',
                    })
                );
                await prepareSourceConnection();
            } else
                retireFavoriteSourceContext(
                    historyInstance,
                    change === 'target' ? f.portal._id : f.playlist._id
                );
            release();
            expect(await result).toBe(change === 'unrelated');
            const record = f.records.get(historyScopeKey(f.scopes[1]))!;
            expect(record.pending).toHaveLength(change === 'unrelated' ? 1 : 0);
            expect(record.base.items).toEqual([]);
            expect(
                f.request.mock.calls.some(
                    ([r]) => r.operation === 'history-apply'
                )
            ).toBe(change === 'unrelated');
            if (change === 'unrelated') {
                f.offline(false);
                await f.runtime.refresh();
                expect(f.runtime.pending()).toBe(0);
                expect(
                    f.records.get(historyScopeKey(f.scopes[1]))!.base.items
                ).toEqual([
                    expect.objectContaining({
                        reference: {
                            provider: 'xtream',
                            kind: 'movie',
                            id: '41',
                        },
                    }),
                ]);
            }
        }
    );

    it('publishes confirmed portal writes and reports storage failures without losing durable work', async () => {
        const f = await historyRuntimeFixture();
        await f.runtime.setEnabled(true);
        await f.runtime.invoke(f.raw as never, 'addRecentItem', [
            { id: 41, type: 'movie', providerId: 41 },
            f.portal._id,
        ]);
        await f.runtime.refresh();
        expect(f.runtime.pending()).toBe(0);
        await expect(
            f.runtime.invoke(f.raw as never, 'synthetic-invalid', [
                null,
                f.portal._id,
            ])
        ).rejects.toThrow('History storage failed');
        expect(f.runtime.error()).toBe(true);
        f.local.mockRejectedValueOnce(new Error('Synthetic storage failure'));
        await expect(
            f.runtime.mutate(f.playlist, { kind: 'clear' })
        ).rejects.toThrow('History storage failed');
        expect(f.runtime.error()).toBe(true);
        expect(
            f.records.get(historyScopeKey(f.scopes[1]))?.base.items
        ).toHaveLength(1);
    });

    it.each(['offline', 'instance', 'capability', 'storage'] as const)(
        'does not persist unsupported or failed consent, %s',
        async (failure) => {
            const f = await historyRuntimeFixture();
            const before = localStorage.getItem(historyConsent);
            if (failure === 'storage')
                f.capabilities.supportsHistoryStorage = false;
            else
                f.request.mockImplementationOnce(async () => {
                    if (failure === 'offline')
                        throw new Error('Synthetic offline');
                    return {
                        status: 200,
                        body: {
                            instanceId:
                                failure === 'instance'
                                    ? 'synthetic-other'
                                    : historyInstance,
                            capabilities: [],
                        },
                    };
                });
            if (failure === 'capability') {
                await f.runtime.setEnabled(true);
                expect(f.runtime.state()).toBe('incompatible');
            } else
                await expect(f.runtime.setEnabled(true)).rejects.toThrow(
                    'History consent failed'
                );
            expect(localStorage.getItem(historyConsent)).toBe(before);
            expect(f.runtime.enabled()).toBe(false);
            expect(f.runtime.busy()).toBe(false);
        }
    );

    it('keeps lazy bridge calls local before consent and refreshes on browser lifecycle signals', async () => {
        const f = await historyRuntimeFixture();
        const bridge = TestBed.runInInjectionContext(
            historyPlaylistBridgeFactory
        );
        localStorage.removeItem(historyConsent);
        expect(bridge.active()).toBe(false);
        expect(await bridge.project(f.playlist)).toBe(f.playlist);
        expect(await bridge.mutate(f.playlist, { kind: 'clear' })).toBeNull();
        await f.runtime.setEnabled(true);
        expect(bridge.active()).toBe(true);
        expect((await bridge.project(f.playlist)).recentlyViewed).toHaveLength(
            1
        );
        await bridge.mutate(f.playlist, { kind: 'clear' });
        await f.runtime.refresh();
        expect((await bridge.project(f.playlist)).recentlyViewed).toEqual([]);
        expect(
            await invokeHistory(
                TestBed.inject(EnvironmentInjector),
                f.raw as never,
                'supportsPortableHistory',
                [f.portal._id]
            )
        ).toBe(true);
        const before = f.refresh.mock.calls.length;
        window.dispatchEvent(new Event('online'));
        await f.runtime.refresh();
        await jest.advanceTimersByTimeAsync(5000);
        expect(f.refresh.mock.calls.length).toBeGreaterThan(before);
        localStorage.setItem(
            historyConsent,
            JSON.stringify({
                enabled: false,
                generation: 'synthetic-sibling',
                deviceId: 'synthetic-device',
            })
        );
        window.dispatchEvent(new Event('storage'));
        expect(f.runtime.state()).toBe('disabled');
        expect(f.runtime.enabled()).toBe(false);
    });

    it('does not overwrite a sibling consent change during verification and serializes toggles', async () => {
        const f = await historyRuntimeFixture();
        f.request.mockImplementationOnce(async () => {
            localStorage.setItem(
                historyConsent,
                JSON.stringify({
                    enabled: false,
                    generation: 'synthetic-sibling',
                    deviceId: 'synthetic-device',
                })
            );
            return {
                status: 200,
                body: {
                    instanceId: historyInstance,
                    capabilities: ['history-v1'],
                },
            };
        });
        await f.runtime.setEnabled(true);
        expect(
            JSON.parse(localStorage.getItem(historyConsent)!).generation
        ).toBe('synthetic-sibling');
        const first = f.runtime.setEnabled(true);
        const second = f.runtime.setEnabled(false);
        await Promise.all([first, second]);
        expect(f.runtime.enabled()).toBe(false);
        expect(JSON.parse(localStorage.getItem(historyConsent)!).enabled).toBe(
            false
        );
        localStorage.setItem(
            favoriteSourceRetirementKey(historyInstance),
            'synthetic-replacement'
        );
        await f.runtime.setEnabled(true);
        expect(f.runtime.state()).toBe('ready');
    });
    it('downloads persisted opt-in on startup without adopting pre-existing history', async () => {
        const f = await historyRuntimeFixture(true, true);
        await jest.advanceTimersByTimeAsync(0);
        await f.runtime.refresh();
        expect(f.runtime.enabled()).toBe(true);
        expect(f.runtime.state()).toBe('ready');
        expect(
            f.request.mock.calls.some(
                ([request]) => request.operation === 'history-apply'
            )
        ).toBe(false);
    });

    it('ignores a late refresh error after opt-out instead of restoring an offline state', async () => {
        const f = await historyRuntimeFixture();
        await f.runtime.setEnabled(true);
        let fail!: (error: Error) => void;
        f.refresh.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    fail = reject;
                })
        );
        const polling = f.runtime.refresh();
        await f.runtime.setEnabled(false);
        fail(new Error('Synthetic late transport failure'));
        await polling;
        expect(f.runtime.enabled()).toBe(false);
        expect(f.runtime.state()).toBe('disabled');
        expect(f.runtime.error()).toBe(false);
    });

    it('rejects a missing server profile before accessing history storage', async () => {
        const f = await historyRuntimeFixture();
        localStorage.removeItem('iptvnator:source-server');
        await prepareSourceConnection();
        await expect(f.runtime.setEnabled(true)).rejects.toThrow(
            'History consent failed'
        );
        await expect(f.runtime.project(f.playlist)).rejects.toThrow(
            'History profile unavailable'
        );
        expect(f.local).not.toHaveBeenCalled();
    });
});

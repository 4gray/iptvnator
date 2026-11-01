import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { PwaXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { activityDataSourceFactory } from './activity-sync.providers';
import { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type {
    ActivityAddress,
    ActivityLocalRecord,
    ActivityLocalStore,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { ActivitySyncRuntime } from './activity-sync-runtime';
import { ActivityPositionAdapter } from './activity-position-adapter';
import { ActivityLocalOnlyPositions } from './activity-local-only-positions';
import { activityEnabled } from './activity-consent';
import { readActivityConsent } from './activity-consent-state';

const consentKey = 'iptvnator-server:synthetic-nas:activity-consent-v1';

function fixture(mode: 'native' | 'browser', watched = false) {
    const position: PlaybackPositionData = {
        contentType: 'vod',
        contentXtreamId: 42,
        positionSeconds: watched ? 100 : 55,
        durationSeconds: 100,
        watched,
    };
    const address: ActivityAddress = {
        instanceId: 'synthetic-nas',
        scope: 'shared',
        sourceId: 'synthetic-source',
        sourceIncarnation: 'synthetic-incarnation',
        content: { provider: 'xtream', kind: 'vod', id: '42' },
    };
    let record: ActivityLocalRecord = {
        state: {
            revision: 2,
            generation: 1,
            owner: {
                deviceId: 'synthetic-device',
                sessionId: 'synthetic-session',
                sequence: 1,
            },
            resume: {
                positionSeconds: position.positionSeconds,
                durationSeconds: 100,
            },
            watched,
            watchedOrigin: watched ? 'automatic' : null,
        },
        position,
        pending: [],
    };
    const store: ActivityLocalStore = {
        read: async () => record,
        entries: async () => [{ address, record }],
        pending: async () => record.pending,
        mutate: async (_address, update) => {
            record = update(record);
            return record;
        },
    };
    let rows: PlaybackPositionData[] = [
        { ...position, positionSeconds: 10, watched: false },
    ];
    let failure = true;
    const save = jest.fn(async (_id: string, value: PlaybackPositionData) => {
        if (failure) throw new Error('Synthetic storage failure');
        rows = [{ ...value }];
    });
    const raw = {
        savePlaybackPosition: save,
        clearPlaybackPosition: jest.fn(async () => {
            rows = [];
        }),
        getAllPlaybackPositions: async () => rows,
        getPlaybackPosition: async () => rows[0] ?? null,
    } as unknown as IXtreamDataSource;
    const request = jest.fn(async () => {
        throw new Error('Unexpected activity request');
    });
    const makeRuntime = () => {
        const runtime = Object.create(
            ActivitySyncRuntime.prototype
        ) as ActivitySyncRuntime;
        const paused = signal(false);
        const localOnly = new ActivityLocalOnlyPositions(
            'synthetic-nas',
            localStorage
        );
        const client = new ActivitySyncClient(store, {
            committed: (sourceId, position, kind) =>
                localOnly.committed(sourceId, position, kind),
            failedLaunch: (sourceId, position, _incarnation, preserveLocal) => {
                if (!preserveLocal || !localOnly.has(sourceId, position))
                    localOnly.mark(sourceId, position);
            },
            instanceId: 'synthetic-nas',
            deviceId: 'synthetic-device',
            contexts: [
                {
                    sourceId: address.sourceId,
                    sourceIncarnation: address.sourceIncarnation,
                    provider: 'xtream',
                },
            ],
            consent: () => {
                const consent = readActivityConsent();
                return consent?.enabled && !consent.disabling && !paused()
                    ? consent.generation
                    : null;
            },
            request,
            changed: () => undefined,
            status: () => undefined,
        });
        const adapter = new ActivityPositionAdapter(
            client,
            mode === 'native'
                ? { save, clear: raw.clearPlaybackPosition.bind(raw) }
                : undefined,
            localOnly
        );
        Object.assign(runtime, {
            client,
            adapter,
            raw,
            deliveryPaused: paused,
            capabilities: { supportsActivityStorage: true },
            sourceIds: async () => [address.sourceId],
            enabled: signal(activityEnabled()),
            busy: signal(false),
            error: signal(false),
            state: signal('ready'),
            pending: signal(0),
            conflicts: signal([]),
            lastSync: signal(null),
        });
        return { runtime, client, adapter, localOnly };
    };
    return {
        makeRuntime,
        raw,
        request,
        save,
        rows: () => rows,
        recover: () => {
            failure = false;
        },
        position,
        sourceId: address.sourceId,
    };
}

describe('retryable activity disable transition', () => {
    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'http://synthetic.invalid/api',
                instanceId: 'synthetic-nas',
            })
        );
        await prepareSourceConnection();
        localStorage.setItem(
            consentKey,
            JSON.stringify({
                enabled: true,
                generation: 'original-consent',
                deviceId: 'synthetic-device',
            })
        );
        jest.useFakeTimers();
    });
    afterEach(async () => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('reconciles a superseded pause after consent reads recover', async () => {
        const f = fixture('native');
        f.recover();
        const { runtime, client } = f.makeRuntime();
        let blocked = false;
        const get = Storage.prototype.getItem;
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
            this: Storage,
            key: string
        ) {
            if (key === consentKey && blocked)
                throw new Error('Synthetic read failure');
            return get.call(this, key);
        });
        const save = f.save.getMockImplementation()!;
        f.save.mockImplementationOnce(async (...args) => {
            await save(...args);
            localStorage.setItem(
                consentKey,
                JSON.stringify({
                    enabled: true,
                    generation: 'synthetic-new-enabled',
                    deviceId: 'synthetic-device',
                })
            );
            blocked = true;
        });
        await runtime.setEnabled(false);
        blocked = false;
        jest.spyOn(client, 'refresh').mockResolvedValue(undefined);
        jest.spyOn(client, 'flush').mockResolvedValue(undefined);
        await runtime.refresh();
        expect(readActivityConsent()).toMatchObject({
            enabled: true,
            disabling: false,
            generation: 'synthetic-new-enabled',
        });
        expect(runtime.enabled()).toBe(true);
    });

    it.each([
        'paused',
        'disabled',
        'disabled-reset',
        'failed-local-write',
    ] as const)(
        'keeps a newer local checkpoint after a delayed shared commit (%s)',
        async (mode) => {
            const f = fixture('native');
            f.recover();
            const { runtime, client, adapter, localOnly } = f.makeRuntime();
            let release!: () => void;
            let entered!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const started = new Promise<void>((resolve) => {
                entered = resolve;
            });
            TestBed.configureTestingModule({
                providers: [
                    {
                        provide: RuntimeCapabilitiesService,
                        useValue: { supportsXtreamSqliteDataSource: false },
                    },
                    { provide: PwaXtreamDataSource, useValue: f.raw },
                    { provide: ActivitySyncRuntime, useValue: runtime },
                ],
            });
            const dataSource = TestBed.runInInjectionContext(
                activityDataSourceFactory
            );
            const mutate = client.store.mutate.bind(client.store);
            jest.spyOn(client.store, 'mutate').mockImplementationOnce(
                async (address, update) => {
                    entered();
                    await held;
                    return mutate(address, update);
                }
            );
            const older = dataSource.savePlaybackPosition(f.sourceId, {
                ...f.position,
                positionSeconds: 50,
                activitySessionId: 'synthetic-session',
            });
            await started;
            localStorage.setItem(
                consentKey,
                JSON.stringify({
                    enabled: mode.startsWith('disabled') ? false : 2,
                    generation: 'original-consent',
                    deviceId: 'synthetic-device',
                })
            );
            if (mode === 'failed-local-write')
                f.save.mockRejectedValueOnce(
                    new Error('Synthetic newer write failure')
                );
            const newer =
                mode === 'disabled-reset'
                    ? dataSource.clearPlaybackPosition(f.sourceId, 42, 'vod')
                    : dataSource.savePlaybackPosition(f.sourceId, {
                          ...f.position,
                          positionSeconds: 75,
                          activitySessionId: 'synthetic-session',
                      });
            if (mode === 'failed-local-write')
                await expect(newer).rejects.toThrow(
                    'Synthetic newer write failure'
                );
            else await newer;
            release();
            await older;
            if (mode === 'disabled-reset') expect(f.rows()).toEqual([]);
            else if (mode === 'disabled')
                expect(f.rows()[0].positionSeconds).toBe(75);
            else
                expect(await adapter.all(f.raw, f.sourceId)).toEqual([
                    expect.objectContaining({ positionSeconds: 75 }),
                ]);
            if (mode === 'failed-local-write')
                expect(
                    localOnly.snapshots(f.sourceId)[0].position.positionSeconds
                ).toBe(75);
        }
    );

    it.each(
        [
            { reset: false, failedBegin: false, failedWrite: false },
            { reset: true, failedBegin: false, failedWrite: false },
            { reset: false, failedBegin: false, failedWrite: true },
            { reset: false, failedBegin: true, failedWrite: true },
        ].flatMap((test) =>
            [false, true].map((beforeCommit) => ({ ...test, beforeCommit }))
        )
    )(
        'preserves newer local actions while an older launch finishes during opt-out (%o)',
        async ({ reset, failedBegin, failedWrite, beforeCommit }) => {
            const f = fixture('native');
            f.recover();
            const { runtime, client, localOnly } = f.makeRuntime();
            let release!: () => void;
            let entered!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const started = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const mutate = client.store.mutate.bind(client.store);
            jest.spyOn(client.store, 'mutate').mockImplementationOnce(
                async (address, update) => {
                    const committed =
                        !beforeCommit && !failedBegin
                            ? await mutate(address, update)
                            : undefined;
                    entered();
                    await held;
                    if (failedBegin)
                        throw new Error('Synthetic launch storage failure');
                    return beforeCommit ? mutate(address, update) : committed!;
                }
            );
            const beginning = client.begin(f.sourceId, {
                ...f.position,
                positionSeconds: 0,
                activitySessionId: 'synthetic-pending-launch',
            });
            await started;
            const disabling = runtime.setEnabled(false);
            for (let i = 0; i < 30; i++) await Promise.resolve();
            if (failedWrite)
                f.save.mockRejectedValueOnce(
                    new Error('Synthetic newer storage failure')
                );
            const writing = reset
                ? runtime.invoke(f.raw, 'clearPlaybackPosition', [
                      f.sourceId,
                      42,
                      'vod',
                  ])
                : runtime.invoke(f.raw, 'savePlaybackPosition', [
                      f.sourceId,
                      {
                          ...f.position,
                          positionSeconds: 75,
                          activitySessionId: 'synthetic-pending-launch',
                      },
                  ]);
            if (failedWrite)
                await expect(writing).rejects.toThrow(
                    'Synthetic newer storage failure'
                );
            else await writing;
            release();
            if (failedBegin)
                await expect(beginning).rejects.toThrow(
                    'Synthetic launch storage failure'
                );
            else if (beforeCommit)
                await expect(beginning).rejects.toThrow(
                    'Activity consent changed'
                );
            else await beginning;
            await disabling;
            expect(runtime.enabled()).toBe(false);
            expect(localOnly.snapshots(f.sourceId)).toEqual([]);
            if (reset) expect(f.rows()).toEqual([]);
            else expect(f.rows()[0].positionSeconds).toBe(75);
        }
    );

    it.each(['origin', 'sibling'] as const)(
        'preserves an already-started %s checkpoint across disable',
        async (writer) => {
            const f = fixture('native');
            f.recover();
            const owner = f.makeRuntime();
            const { runtime } = owner;
            const { client, adapter } =
                writer === 'origin' ? owner : f.makeRuntime();
            let release!: () => void;
            let started!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const entered = new Promise<void>((resolve) => {
                started = resolve;
            });
            const mutate = client.store.mutate.bind(client.store);
            jest.spyOn(client.store, 'mutate').mockImplementationOnce(
                async (address, update) => {
                    started();
                    await held;
                    return mutate(address, update);
                }
            );
            const checkpoint = adapter.invoke(f.raw, 'savePlaybackPosition', [
                f.sourceId,
                {
                    ...f.position,
                    positionSeconds: 65,
                    activitySessionId: 'synthetic-session',
                },
            ]);
            await entered;
            const disable = runtime.setEnabled(false);
            for (let i = 0; i < 30; i++) await Promise.resolve();
            release();
            await Promise.all([checkpoint, disable]);
            expect(runtime.enabled()).toBe(false);
            expect(f.rows()[0].positionSeconds).toBe(65);
        }
    );
    it.each([
        ['native', false],
        ['native', true],
        ['browser', false],
        ['browser', true],
    ] as const)(
        'keeps shared views on a failed %s mirror and retries after restart (watched: %s)',
        async (mode, watched) => {
            const f = fixture(mode, watched);
            const { runtime, client } = f.makeRuntime();
            await runtime.setEnabled(false);
            expect(runtime.error()).toBe(true);
            expect(runtime.enabled()).toBe(true);
            expect(activityEnabled()).toBe(true);
            expect(readActivityConsent()).toMatchObject({
                enabled: true,
                disabling: true,
                generation: 'original-consent',
            });
            expect(client.options.consent()).toBeNull();
            expect(
                await runtime.invoke(f.raw, 'getPlaybackPosition', [
                    f.sourceId,
                    42,
                    'vod',
                ])
            ).toMatchObject({ positionSeconds: f.position.positionSeconds });
            expect(f.rows()[0].positionSeconds).toBe(10);
            expect(f.request).not.toHaveBeenCalled();
            jest.clearAllTimers(); // Closing the first renderer.
            f.recover();
            const reopened = f.makeRuntime().runtime;
            await reopened.start();
            expect(reopened.enabled()).toBe(false);
            expect(readActivityConsent()?.enabled).toBe(false);
            expect(readActivityConsent()?.disabling).not.toBe(true);
            expect(f.rows()[0].positionSeconds).toBe(
                f.position.positionSeconds
            );
            expect(f.request).not.toHaveBeenCalled();
        }
    );
    it('keeps a new local checkpoint durable when its raw write fails, then copies it after restart', async () => {
        const f = fixture('native');
        const { runtime } = f.makeRuntime();
        await runtime.setEnabled(false);
        await expect(
            runtime.invoke(f.raw, 'savePlaybackPosition', [
                f.sourceId,
                {
                    ...f.position,
                    positionSeconds: 65,
                    activitySessionId: 'synthetic-local-session',
                },
            ])
        ).rejects.toThrow('Synthetic storage failure');
        expect(f.rows()[0].positionSeconds).toBe(10);
        expect(
            await runtime.invoke(f.raw, 'getPlaybackPosition', [
                f.sourceId,
                42,
                'vod',
            ])
        ).toMatchObject({ positionSeconds: 65 });
        jest.clearAllTimers();
        f.recover();
        const reopened = f.makeRuntime().runtime;
        await reopened.start();
        expect(reopened.enabled()).toBe(false);
        expect(f.rows()[0].positionSeconds).toBe(65);
        expect(f.request).not.toHaveBeenCalled();
    });
    it.each(['native', 'browser'] as const)(
        'retries a failed %s local clear after restart',
        async (mode) => {
            const f = fixture(mode);
            const { runtime } = f.makeRuntime();
            await runtime.setEnabled(false);
            jest.spyOn(f.raw, 'clearPlaybackPosition').mockRejectedValueOnce(
                new Error('Synthetic clear failure')
            );
            await expect(
                runtime.invoke(f.raw, 'clearPlaybackPosition', [
                    f.sourceId,
                    42,
                    'vod',
                ])
            ).rejects.toThrow('Synthetic clear failure');
            expect(
                await runtime.invoke(f.raw, 'getPlaybackPosition', [
                    f.sourceId,
                    42,
                    'vod',
                ])
            ).toBeNull();
            expect(f.rows()).toHaveLength(1);
            jest.clearAllTimers();
            f.recover();
            const reopened = f.makeRuntime().runtime;
            await reopened.start();
            expect(reopened.enabled()).toBe(false);
            expect(f.rows()).toEqual([]);
            expect(f.request).not.toHaveBeenCalled();
        }
    );

    it.each(['native', 'browser'] as const)(
        'orders a %s clear after an older pending local save',
        async (mode) => {
            const f = fixture(mode);
            const { runtime } = f.makeRuntime();
            await runtime.setEnabled(false);
            f.recover();
            let release!: () => void;
            let started!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const entered = new Promise<void>((resolve) => {
                started = resolve;
            });
            const save = f.save.getMockImplementation()!;
            f.save.mockImplementationOnce(async (...args) => {
                started();
                await held;
                await save(...args);
            });
            const writing = runtime.invoke(f.raw, 'savePlaybackPosition', [
                f.sourceId,
                {
                    ...f.position,
                    positionSeconds: 65,
                    activitySessionId: 'synthetic-local-session',
                },
            ]);
            await entered;
            const clearing = runtime.invoke(f.raw, 'clearPlaybackPosition', [
                f.sourceId,
                42,
                'vod',
            ]);
            for (let i = 0; i < 30; i++) await Promise.resolve();
            release();
            await Promise.all([writing, clearing]);
            await runtime.setEnabled(false);
            expect(runtime.enabled()).toBe(false);
            expect(f.rows()).toEqual([]);
            expect(f.request).not.toHaveBeenCalled();
        }
    );

    it('waits for in-flight local writes before completing opt-out', async () => {
        const f = fixture('native');
        const { runtime } = f.makeRuntime();
        await runtime.setEnabled(false);
        f.recover();
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const save = f.save.getMockImplementation()!;
        f.save.mockImplementationOnce(async (...args) => {
            await held;
            await save(...args);
        });
        const writing = runtime.invoke(f.raw, 'savePlaybackPosition', [
            f.sourceId,
            {
                ...f.position,
                positionSeconds: 65,
                activitySessionId: 'synthetic-local-session',
            },
        ]);
        const disabling = runtime.setEnabled(false);
        await jest.advanceTimersByTimeAsync(0);
        expect(runtime.enabled()).toBe(true);
        expect(f.rows()[0].positionSeconds).toBe(10);
        release();
        await Promise.all([writing, disabling]);
        expect(runtime.enabled()).toBe(false);
        expect(f.rows()[0].positionSeconds).toBe(65);
    });
    it('retries final consent persistence without hiding the shared projection', async () => {
        const f = fixture('native');
        f.recover();
        const original = Storage.prototype.setItem;
        let blocked = true;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            if (
                key === consentKey &&
                JSON.parse(value).enabled === false &&
                blocked
            )
                throw new Error('Synthetic quota failure');
            original.call(this, key, value);
        });
        const { runtime } = f.makeRuntime();
        await runtime.setEnabled(false);
        expect(runtime.enabled()).toBe(true);
        expect(runtime.error()).toBe(true);
        expect(readActivityConsent()?.disabling).toBe(true);
        blocked = false;
        await jest.advanceTimersByTimeAsync(5000);
        expect(runtime.enabled()).toBe(false);
        expect(runtime.error()).toBe(false);
        expect(f.rows()[0].positionSeconds).toBe(55);
        expect(f.request).not.toHaveBeenCalled();
    });
    it('pauses in memory if even the consent write fails and retries when storage recovers', async () => {
        const f = fixture('native');
        f.recover();
        const original = Storage.prototype.setItem;
        let blocked = true;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            if (key === consentKey && blocked)
                throw new Error('Synthetic storage failure');
            original.call(this, key, value);
        });
        const { runtime, client } = f.makeRuntime();
        await runtime.setEnabled(false);
        expect(runtime.enabled()).toBe(true);
        expect(client.options.consent()).toBeNull();
        expect(runtime.error()).toBe(true);
        blocked = false;
        await jest.advanceTimersByTimeAsync(5000);
        expect(runtime.enabled()).toBe(false);
        expect(runtime.error()).toBe(false);
        expect(f.rows()[0].positionSeconds).toBe(55);
        expect(f.request).not.toHaveBeenCalled();
    });
    it('keeps actions during a paused transition local and preserves them on retry', async () => {
        const f = fixture('browser');
        const { runtime } = f.makeRuntime();
        await runtime.setEnabled(false);
        f.recover();
        await runtime.invoke(f.raw, 'savePlaybackPosition', [
            f.sourceId,
            {
                ...f.position,
                positionSeconds: 65,
                activitySessionId: 'synthetic-paused-launch',
            },
        ]);
        expect(f.rows()[0].positionSeconds).toBe(65);
        await jest.advanceTimersByTimeAsync(5000);
        expect(runtime.enabled()).toBe(false);
        expect(f.rows()[0].positionSeconds).toBe(65);
        expect(f.request).not.toHaveBeenCalled();
    });
});

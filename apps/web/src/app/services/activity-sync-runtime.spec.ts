import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    PlaybackPositionRuntimeBridgeService,
} from '@iptvnator/services';
import * as actualSourceApi from '@iptvnator/services/source-sync';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    PwaXtreamDataSource,
    type IXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import {
    emptyActivityState,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalStore,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { createActivityRuntimeClient } from './activity-runtime-client';
import type { ActivityPositionAdapter } from './activity-position-adapter';

const createClient = jest.fn() as jest.MockedFunction<
    typeof createActivityRuntimeClient
>;
jest.unstable_mockModule(
    fileURLToPath(new URL('./activity-runtime-client.ts', import.meta.url)),
    () => ({ createActivityRuntimeClient: createClient })
);
jest.unstable_mockModule('@iptvnator/services/source-sync', () => ({
    ...actualSourceApi,
    requestSourceServer: jest.fn(async () => ({
        status: 200,
        body: { capabilities: ['activity-v1'] },
    })),
}));
const { ActivitySyncRuntime } = await import('./activity-sync-runtime');
const consentKey = 'iptvnator-server:synthetic-nas:activity-consent-v1';
const address: ActivityAddress = {
    instanceId: 'synthetic-nas',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-current',
    content: { provider: 'xtream', kind: 'vod', id: '42' },
};
const position: PlaybackPositionData = {
    playlistId: address.sourceId,
    contentType: 'vod',
    contentXtreamId: 42,
    positionSeconds: 25,
    durationSeconds: 100,
};

function fixture() {
    let events!: Parameters<typeof createActivityRuntimeClient>[2];
    const entries: { address: ActivityAddress; record: ActivityLocalRecord }[] =
        [];
    const store: ActivityLocalStore = {
        read: async (target) =>
            entries.find((e) => e.address.sourceId === target.sourceId)
                ?.record ?? null,
        entries: async (sourceId) =>
            entries.filter((e) => e.address.sourceId === sourceId),
        pending: async () => entries.flatMap((e) => e.record.pending),
        mutate: async (target, update) => {
            const entry = entries.find(
                (e) => e.address.sourceId === target.sourceId
            );
            const value = update(entry?.record ?? null);
            if (entry) entry.record = value;
            else entries.push({ address: target, record: value });
            return value;
        },
    };
    const refresh = jest.fn(async (_sourceId: string) => {
        events.status('ready');
    });
    const begin = jest.fn(
        async (_id: string, _position: PlaybackPositionData) => ({
            address,
            generation: 1,
        })
    );
    const resolve = jest.fn(
        async (_address: ActivityAddress, _local: boolean) => undefined
    );
    const client = {
        contexts: new Map([
            [
                address.sourceId,
                {
                    sourceId: address.sourceId,
                    sourceIncarnation: address.sourceIncarnation,
                    provider: 'xtream',
                },
            ],
            [
                'synthetic-removed',
                {
                    sourceId: 'synthetic-removed',
                    sourceIncarnation: 'old',
                    provider: 'xtream',
                },
            ],
        ]),
        store,
        options: { instanceId: address.instanceId },
        refresh,
        begin,
        resolve,
        register: jest.fn(),
        importPosition: jest.fn(
            async (_id: string, _position: PlaybackPositionData) => undefined
        ),
        flush: jest.fn(async () => undefined),
        stopDelivery: jest.fn(async () => undefined),
    } as unknown as ActivitySyncClient;
    const adapter = {
        invoke: jest.fn(
            async (
                _raw: unknown,
                _method: string,
                _args: unknown[],
                _local?: boolean
            ) => undefined
        ),
        exportPositions: jest.fn(
            async (_id: string, local: PlaybackPositionData[]) => local
        ),
        keepLocal: jest.fn(async () => undefined),
        protectLocal: jest.fn(),
        supersede: jest.fn(),
    };
    createClient.mockImplementation((_cap, _bridge, callbacks) => {
        events = callbacks;
        return {
            client,
            adapter: adapter as unknown as ActivityPositionAdapter,
        };
    });
    const raw = {
        getAllPlaybackPositions: jest.fn(async (id: string) => [
            { ...position, playlistId: id },
        ]),
        getCategories: jest.fn(async () => []),
    };
    const sourceRefresh = jest.fn(async () => undefined);
    TestBed.configureTestingModule({
        providers: [
            {
                provide: RuntimeCapabilitiesService,
                useValue: {
                    supportsActivityStorage: true,
                    supportsXtreamSqliteDataSource: false,
                },
            },
            {
                provide: actualSourceApi.SourceSyncService,
                useValue: { refresh: sourceRefresh },
            },
            { provide: PlaybackPositionRuntimeBridgeService, useValue: {} },
            {
                provide: PlaylistsService,
                useValue: {
                    getAllPlaylists: () =>
                        of([
                            {
                                _id: address.sourceId,
                                serverUrl: 'http://synthetic.invalid',
                            },
                            {
                                _id: 'synthetic-stalker',
                                portalUrl: 'http://synthetic.invalid/portal',
                            },
                            {
                                _id: 'synthetic-m3u',
                                url: 'http://synthetic.invalid/list',
                            },
                        ]),
                },
            },
            { provide: PwaXtreamDataSource, useValue: raw },
        ],
    });
    const runtime = TestBed.inject(ActivitySyncRuntime);
    const activate = () => {
        localStorage.setItem(
            consentKey,
            JSON.stringify({
                enabled: true,
                generation: 'synthetic-consent',
                deviceId: 'synthetic-device',
            })
        );
        runtime.enabled.set(true);
    };
    return {
        runtime,
        client,
        adapter,
        raw,
        sourceRefresh,
        entries,
        activate,
        refresh,
        begin,
        resolve,
        events: () => events,
    };
}

describe('activity runtime lifecycle and settings orchestration', () => {
    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'http://synthetic.invalid/api',
                instanceId: address.instanceId,
            })
        );
        await prepareSourceConnection();
        localStorage.setItem(
            consentKey,
            JSON.stringify({
                enabled: false,
                generation: 'synthetic-consent',
                deviceId: 'synthetic-device',
            })
        );
        jest.useFakeTimers();
    });
    afterEach(async () => {
        TestBed.resetTestingModule();
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
        jest.clearAllMocks();
        localStorage.clear();
        await prepareSourceConnection();
    });

    it('stays local without consent and cleans up its listeners on destruction', async () => {
        const f = fixture();
        await f.runtime.start();
        await f.runtime.refresh();
        expect(createClient).not.toHaveBeenCalled();
        expect(f.runtime.stateKey()).toBe('ACTIVITY_SYNC.STATE_disabled');
        f.runtime.state.set('synthetic-unknown-state');
        expect(f.runtime.stateKey()).toBe('ACTIVITY_SYNC.ERROR');
        const remove = jest.spyOn(window, 'removeEventListener');
        TestBed.resetTestingModule();
        expect(remove.mock.calls.map(([name]) => name)).toEqual(
            expect.arrayContaining(['online', 'focus', 'storage'])
        );
        expect(jest.getTimerCount()).toBe(0);
    });

    it('restores enabled consent on startup and reacts to connectivity and sibling changes', async () => {
        localStorage.setItem(
            consentKey,
            JSON.stringify({
                enabled: true,
                generation: 'synthetic-consent',
                deviceId: 'synthetic-device',
            })
        );
        const f = fixture();
        jest.runAllTicks();
        await f.runtime.refresh();
        expect(f.runtime.state()).toBe('ready');
        expect(f.refresh).toHaveBeenCalledTimes(2);
        for (const name of ['online', 'focus', 'storage']) {
            window.dispatchEvent(new Event(name));
            await f.runtime.refresh();
        }
        expect(f.refresh).toHaveBeenCalledTimes(8);
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('focus'));
        expect(f.refresh).toHaveBeenCalledTimes(8);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('enables only after server capability approval and previews local activity without importing it', async () => {
        const f = fixture();
        await f.runtime.setEnabled(true);
        expect(f.sourceRefresh).toHaveBeenCalledTimes(1);
        expect(f.runtime.enabled()).toBe(true);
        expect(f.client.contexts.has('synthetic-removed')).toBe(false);
        expect(f.refresh.mock.calls.map(([id]) => id)).toEqual([
            address.sourceId,
            'synthetic-stalker',
        ]);
        expect(f.runtime.lastSync()).toBeInstanceOf(Date);
        const preview = await f.runtime.previewImport();
        expect(preview.map((e) => e.sourceId)).toEqual([
            address.sourceId,
            'synthetic-stalker',
        ]);
        expect(f.client.importPosition).not.toHaveBeenCalled();
        jest.spyOn(f.client, 'importPosition').mockRejectedValueOnce(
            new Error('Synthetic unmapped source')
        );
        await expect(f.runtime.importPositions(preview)).resolves.toBe(1);
        expect(f.client.importPosition).toHaveBeenCalledTimes(2);
        await f.runtime.setEnabled(false);
        expect(f.adapter.keepLocal).toHaveBeenCalledTimes(2);
        expect(f.runtime.enabled()).toBe(false);
        expect(f.runtime.state()).toBe('disabled');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('coalesces refreshes, polls only visible clients and releases the interval on destroy', async () => {
        const f = fixture();
        f.activate();
        await f.runtime.start();
        let release!: () => void;
        f.refresh.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                })
        );
        const first = f.runtime.refresh();
        const second = f.runtime.refresh();
        expect(first).toBe(second);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        release();
        await first;
        const before = f.refresh.mock.calls.length;
        jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        jest.advanceTimersByTime(5000);
        await f.runtime.refresh();
        expect(f.refresh.mock.calls.length).toBe(before + 2);
        jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        jest.advanceTimersByTime(5000);
        expect(f.refresh.mock.calls.length).toBe(before + 2);
        TestBed.resetTestingModule();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('forwards playback ownership and reports storage failure without losing the raw local path', async () => {
        const f = fixture();
        f.activate();
        await f.runtime.begin(
            {
                ...position,
                playlistId: address.sourceId,
                activitySessionId: 'synthetic-player',
            },
            17
        );
        expect(f.begin).toHaveBeenCalledWith(
            address.sourceId,
            expect.objectContaining({ positionSeconds: 17 })
        );
        f.runtime.register(address.sourceId, [position]);
        expect(f.client.register).toHaveBeenCalledWith(address.sourceId, [
            position,
        ]);
        await expect(
            f.runtime.exportPositions(address.sourceId, [position])
        ).resolves.toEqual([position]);
        await f.runtime.invoke(
            f.raw as unknown as IXtreamDataSource,
            'getCategories',
            [address.sourceId]
        );
        expect(f.raw.getCategories).toHaveBeenCalled();
        expect(f.adapter.supersede).toHaveBeenCalledWith('getCategories', [
            address.sourceId,
        ]);
        f.adapter.invoke.mockRejectedValueOnce(
            new Error('Synthetic local write failure')
        );
        await f.runtime.checkpoint(position);
        expect(f.runtime.state()).toBe('offline');
        localStorage.setItem(
            consentKey,
            JSON.stringify({
                enabled: 2,
                generation: 'synthetic-consent',
                deviceId: 'synthetic-device',
            })
        );
        f.adapter.invoke.mockRejectedValueOnce(
            new Error('Synthetic paused write failure')
        );
        await f.runtime.checkpoint(position);
        expect(f.adapter.invoke).toHaveBeenLastCalledWith(
            f.raw,
            'savePlaybackPosition',
            [address.sourceId, position],
            true
        );
        expect(f.runtime.state()).toBe('disabling');
        expect(f.runtime.error()).toBe(true);
    });

    it('summarizes conflicts, retries failed choices and keeps parked changes local unless explicitly sent', async () => {
        const f = fixture();
        f.activate();
        await f.runtime.start();
        const state = emptyActivityState();
        f.entries.push({
            address,
            record: {
                state,
                position,
                conflict: state,
                pending: [
                    {
                        address,
                        consentGeneration: 'synthetic-old',
                        operation: {
                            kind: 'reset',
                            operationId: 'synthetic-reset',
                            deviceId: 'synthetic-device',
                            expectedRevision: 0,
                        },
                    },
                ],
            },
        });
        await f.runtime.refresh();
        expect(f.runtime.pending()).toBe(1);
        expect(f.runtime.conflicts()).toHaveLength(1);
        f.resolve.mockRejectedValueOnce(
            new Error('Synthetic offline conflict choice')
        );
        await f.runtime.resolve(address, true);
        expect(f.runtime.error()).toBe(true);
        expect(f.runtime.busy()).toBe(false);
        await f.runtime.resolve(address, true);
        expect(f.runtime.error()).toBe(false);
        await f.runtime.parked(false);
        expect(f.adapter.keepLocal).toHaveBeenCalledTimes(2);
        expect(f.adapter.protectLocal).toHaveBeenCalledWith(
            address.sourceId,
            position
        );
        expect(f.resolve).toHaveBeenLastCalledWith(address, false, true);
        await f.runtime.parked(true);
        expect(f.entries[0].record.pending[0].consentGeneration).toBe(
            'synthetic-consent'
        );
        expect(f.entries[0].record.pending[0].deliveryLease).toBeUndefined();
        expect(f.client.flush).toHaveBeenCalledTimes(2);
    });
});

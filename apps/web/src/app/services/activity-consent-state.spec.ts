import type { ActivityLocalRequest } from '@iptvnator/shared/interfaces/activity-sync';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { signal } from '@angular/core';
import type {
    RuntimeCapabilitiesService,
    PlaybackPositionRuntimeBridgeService,
} from '@iptvnator/services';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import { activityEnabled } from './activity-consent';
import {
    readActivityConsent,
    writeActivityConsent,
} from './activity-consent-state';
import { createActivityRuntimeClient } from './activity-runtime-client';
const key = 'iptvnator-server:synthetic-nas:activity-consent-v1';
const position = {
    contentType: 'vod' as const,
    contentXtreamId: 42,
    positionSeconds: 10,
};
const original = {
    enabled: true,
    generation: 'synthetic-consent',
    deviceId: 'synthetic-device',
};
describe('activity consent persistence', () => {
    beforeEach(async () => {
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'http://synthetic.invalid/api',
                instanceId: 'synthetic-nas',
            })
        );
        await prepareSourceConnection();
        localStorage.setItem(key, JSON.stringify(original));
    });
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('reads historical booleans and uses a smaller durable pause value', () => {
        expect(readActivityConsent()).toMatchObject({
            enabled: true,
            disabling: false,
        });
        const size = localStorage.getItem(key)!.length;
        writeActivityConsent(key, { ...original, disabling: true });
        expect(localStorage.getItem(key)!.length).toBeLessThanOrEqual(size);
        expect(readActivityConsent()).toMatchObject({
            enabled: true,
            disabling: true,
            generation: original.generation,
        });
        expect(activityEnabled()).toBe(true);
        writeActivityConsent(key, { ...original, enabled: false });
        expect(activityEnabled()).toBe(false);
        expect(readActivityConsent()).toMatchObject({
            enabled: false,
            disabling: false,
        });
    });
    it('keeps a newer durable snapshot when an obsolete launch failure reaches the actual runtime callback', async () => {
        const { client, adapter } = createActivityRuntimeClient(
            {
                supportsActivityStorage: true,
                isElectron: true,
                supportsXtreamSqliteDataSource: false,
            } as RuntimeCapabilitiesService,
            {} as PlaybackPositionRuntimeBridgeService,
            { changed: () => undefined, status: () => undefined },
            signal(false)
        );
        jest.spyOn(client, 'positions').mockResolvedValue([]);
        const raw = {
            getAllPlaybackPositions: async () => [],
            savePlaybackPosition: async () => {
                throw new Error('Synthetic pending write');
            },
        } as unknown as IXtreamDataSource;
        await expect(
            adapter.invoke(
                raw,
                'savePlaybackPosition',
                [
                    'synthetic-source',
                    {
                        ...position,
                        positionSeconds: 75,
                        activitySessionId: 'synthetic-newer-session',
                    },
                ],
                true
            )
        ).rejects.toThrow('Synthetic pending write');
        client.options.failedLaunch?.(
            'synthetic-source',
            { ...position, activitySessionId: 'synthetic-older-session' },
            undefined,
            true
        );
        expect(await adapter.all(raw, 'synthetic-source')).toEqual([
            expect.objectContaining({ positionSeconds: 75 }),
        ]);
    });

    it('selects the verified desktop IPC store and strict local writers', async () => {
        const previous = window.electron;
        const send = jest.fn(async (request: ActivityLocalRequest) =>
            request.operation === 'read'
                ? null
                : request.operation === 'commit'
                  ? { value: request.value }
                  : []
        );
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { activityLocalRequest: send },
        });
        const save = jest.fn(async () => undefined);
        const clear = jest.fn(async () => undefined);
        try {
            const { client, adapter } = createActivityRuntimeClient(
                {
                    supportsActivityStorage: true,
                    isElectron: true,
                    supportsXtreamSqliteDataSource: true,
                } as RuntimeCapabilitiesService,
                {
                    savePlaybackPositionOrThrow: save,
                    clearPlaybackPositionOrThrow: clear,
                } as unknown as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined }
            );
            const address = {
                instanceId: 'synthetic-nas',
                scope: 'shared' as const,
                sourceId: 'synthetic-source',
                sourceIncarnation: 'synthetic-incarnation',
                content: {
                    provider: 'xtream' as const,
                    kind: 'vod' as const,
                    id: '42',
                },
            };
            await expect(client.store.read(address)).resolves.toBeNull();
            await expect(client.store.pending()).resolves.toEqual([]);
            const raw = {
                getAllPlaybackPositions: async () => [],
                savePlaybackPosition: jest.fn(async () => undefined),
                clearPlaybackPosition: jest.fn(async () => undefined),
            } as unknown as IXtreamDataSource;
            await adapter.invoke(
                raw,
                'savePlaybackPosition',
                [address.sourceId, position],
                true
            );
            await adapter.invoke(
                raw,
                'clearPlaybackPosition',
                [address.sourceId, 42, 'vod'],
                true
            );
            expect(save).toHaveBeenCalledWith(
                address.sourceId,
                expect.objectContaining({ positionSeconds: 10 })
            );
            expect(clear).toHaveBeenCalledWith(address.sourceId, 42, 'vod');
            expect(raw.savePlaybackPosition).not.toHaveBeenCalled();
            expect(raw.clearPlaybackPosition).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: previous,
            });
        }
    });

    it.each([
        '{',
        '{}',
        '[null,{"sourceId":"synthetic-source","sourceIncarnation":"synthetic-incarnation","provider":"unsupported"}]',
    ])(
        'recovers an unusable context cache without authorizing a new profile (%s)',
        (saved) => {
            localStorage.setItem(
                'iptvnator-server:synthetic-nas:activity-contexts-v1',
                saved
            );
            const { client } = createActivityRuntimeClient(
                {
                    supportsActivityStorage: true,
                    isElectron: false,
                    supportsXtreamSqliteDataSource: false,
                } as RuntimeCapabilitiesService,
                {} as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined }
            );
            expect(client.contexts.size).toBe(0);
            expect(client.options.consent()).toBe(original.generation);
        }
    );

    it('does not create a store when consent or the runtime storage capability is missing', () => {
        const create = (supportsActivityStorage: boolean) =>
            createActivityRuntimeClient(
                {
                    supportsActivityStorage,
                    isElectron: true,
                    supportsXtreamSqliteDataSource: false,
                } as RuntimeCapabilitiesService,
                {} as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined }
            );
        expect(() => create(false)).toThrow('Activity profile unavailable');
        localStorage.removeItem(key);
        expect(() => create(true)).toThrow('Activity profile unavailable');
    });

    it('pauses the actual runtime client without bypassing shared reads', () => {
        const paused = signal(false);
        const makeClient = () =>
            createActivityRuntimeClient(
                {
                    supportsActivityStorage: true,
                    isElectron: true,
                    supportsXtreamSqliteDataSource: false,
                } as RuntimeCapabilitiesService,
                {} as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined },
                paused
            ).client;
        const client = makeClient();
        expect(client.options.consent()).toBe(original.generation);
        paused.set(true);
        expect(client.options.consent()).toBeNull();
        paused.set(false);
        writeActivityConsent(key, { ...original, disabling: true });
        expect(activityEnabled()).toBe(true);
        expect(makeClient().options.consent()).toBeNull();
    });
    it('keeps replacement-source progress above retired local ownership through the actual factory', async () => {
        const contextKey =
            'iptvnator-server:synthetic-nas:activity-contexts-v1';
        const context = {
            sourceId: 'synthetic-source',
            provider: 'xtream' as const,
            sourceIncarnation: 'original',
        };
        localStorage.setItem(contextKey, JSON.stringify([context]));
        const make = () =>
            createActivityRuntimeClient(
                {
                    supportsActivityStorage: true,
                    isElectron: true,
                    supportsXtreamSqliteDataSource: false,
                } as RuntimeCapabilitiesService,
                {} as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined }
            );
        const created = make();
        let point = { ...position, positionSeconds: 65, durationSeconds: 100 };
        const raw = {
            savePlaybackPosition: async (_id: string, value: typeof point) => {
                point = value;
            },
            getAllPlaybackPositions: async () => [point],
        } as unknown as IXtreamDataSource;
        created.client.localSessions.set('synthetic-failed-session', {
            sourceId: context.sourceId,
            incarnation: context.sourceIncarnation,
        });
        await created.adapter.invoke(raw, 'savePlaybackPosition', [
            'synthetic-source',
            { ...point, activitySessionId: 'synthetic-failed-session' },
        ]);
        const replacement = { ...context, sourceIncarnation: 'replacement' };
        created.client.acceptContext(replacement);
        created.client.options.remember!([replacement]);
        const remote = {
            position: { ...point, positionSeconds: 30 },
            reset: false,
            conflict: false,
        };
        jest.spyOn(created.client, 'positions').mockResolvedValue([remote]);
        expect(
            (await created.adapter.all(raw, context.sourceId))[0]
                .positionSeconds
        ).toBe(30);
        const reopened = make();
        jest.spyOn(reopened.client, 'positions').mockResolvedValue([remote]);
        expect(
            (await reopened.adapter.all(raw, context.sourceId))[0]
                .positionSeconds
        ).toBe(30);
        await reopened.adapter.keepLocal(raw, context.sourceId);
        expect(point.positionSeconds).toBe(30);
    });
    it('recovers a failed external launch after reload before its first checkpoint', async () => {
        const make = () =>
            createActivityRuntimeClient(
                {
                    supportsActivityStorage: true,
                    isElectron: true,
                    supportsXtreamSqliteDataSource: false,
                } as RuntimeCapabilitiesService,
                {} as PlaybackPositionRuntimeBridgeService,
                { changed: () => undefined, status: () => undefined }
            );
        const launch = {
            ...position,
            activitySessionId: 'synthetic-external-session',
        };
        const first = make();
        jest.spyOn(first.client.options, 'request').mockRejectedValue(
            new Error('Synthetic offline launch')
        );
        await expect(
            first.client.begin('synthetic-source', launch)
        ).rejects.toThrow();
        localStorage.setItem(
            'iptvnator-server:synthetic-nas:activity-contexts-v1',
            JSON.stringify([
                {
                    sourceId: 'synthetic-source',
                    provider: 'xtream',
                    sourceIncarnation: 'original',
                },
            ])
        );
        const reopened = make();
        jest.spyOn(reopened.client.store, 'read').mockResolvedValue(null);
        const save = jest.fn(async () => undefined);
        const raw = {
            savePlaybackPosition: save,
        } as unknown as IXtreamDataSource;
        await reopened.adapter.invoke(raw, 'savePlaybackPosition', [
            'synthetic-source',
            { ...launch, positionSeconds: 65 },
        ]);
        expect(save).toHaveBeenCalledWith(
            'synthetic-source',
            expect.objectContaining({ positionSeconds: 65 })
        );
        expect(
            reopened.client.retiredSessions.has(launch.activitySessionId)
        ).toBe(false);
    });
    it.each([1, 'true', null, '2'])(
        'rejects invalid consent values (%s)',
        (enabled) => {
            localStorage.setItem(key, JSON.stringify({ ...original, enabled }));
            expect(readActivityConsent).toThrow('Activity consent unavailable');
            expect(activityEnabled()).toBe(false);
        }
    );
});

import { signal } from '@angular/core';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    activityAddressKey,
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalStore,
    type ActivityOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { ActivityPositionAdapter } from './activity-position-adapter';
import { ActivitySyncRuntime } from './activity-sync-runtime';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture() {
    const context = {
        sourceId: 'synthetic-source',
        provider: 'xtream' as const,
        sourceIncarnation: 'current-incarnation',
    };
    const address: ActivityAddress = {
        instanceId: 'synthetic-nas',
        scope: 'shared',
        sourceId: context.sourceId,
        sourceIncarnation: context.sourceIncarnation,
        content: { provider: 'xtream', kind: 'vod', id: '42' },
    };
    const rows = new Map<
        string,
        { address: ActivityAddress; record: ActivityLocalRecord }
    >();
    const store: ActivityLocalStore = {
        read: async (key) =>
            clone(rows.get(activityAddressKey(key))?.record ?? null),
        entries: async (id) =>
            clone(
                [...rows.values()].filter((row) => row.address.sourceId === id)
            ),
        pending: async () =>
            clone([...rows.values()].flatMap((row) => row.record.pending)),
        mutate: async (key, change) => {
            const record = change(
                clone(rows.get(activityAddressKey(key))?.record ?? null)
            );
            rows.set(activityAddressKey(key), clone({ address: key, record }));
            return clone(record);
        },
    };
    let remote = emptyActivityState();
    let offline = false;
    const client = new ActivitySyncClient(store, {
        instanceId: address.instanceId,
        deviceId: 'synthetic-device',
        contexts: [context],
        consent: () => 'current-consent',
        status: () => undefined,
        changed: () => undefined,
        request: async (input) => {
            if (offline) throw new Error('Synthetic offline transport');
            if (input.operation === 'activity-context')
                return { status: 200, body: context };
            if (input.operation === 'activity-list')
                return {
                    status: 200,
                    body: { entries: [{ address, state: remote }] },
                };
            if (
                input.activity?.address.sourceIncarnation !==
                context.sourceIncarnation
            )
                return {
                    status: 409,
                    body: { error: 'Retired source incarnation' },
                };
            if (input.operation === 'activity-read')
                return { status: 200, body: remote };
            const result = applyActivityOperation(
                remote,
                input.activity!.operation!
            );
            if (result.status === 'applied') remote = result.state;
            return { status: 200, body: result };
        },
    });
    const saved: PlaybackPositionData[] = [];
    const raw = {
        getAllPlaybackPositions: async () => saved,
        savePlaybackPosition: jest.fn(
            async (_id: string, position: PlaybackPositionData) => {
                saved.push(position);
            }
        ),
        clearPlaybackPosition: jest.fn(async () => {
            saved.length = 0;
        }),
    } as unknown as IXtreamDataSource;
    const adapter = new ActivityPositionAdapter(client);
    const position: PlaybackPositionData = {
        playlistId: context.sourceId,
        contentType: 'vod',
        contentXtreamId: 42,
        positionSeconds: 20,
        durationSeconds: 100,
    };
    return {
        address,
        store,
        client,
        raw,
        adapter,
        position,
        saved,
        setOffline: (value: boolean) => {
            offline = value;
        },
        setRemote: (operation: ActivityOperation) => {
            remote = applyActivityOperation(remote, operation).state;
            return remote;
        },
    };
}

describe('keeping pending activity local', () => {
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('continues saving locally after an uncached offline launch and recovery', async () => {
        const f = fixture();
        f.client.contexts.clear();
        f.setOffline(true);
        const position = {
            ...f.position,
            activitySessionId: 'synthetic-offline-launch',
        };
        await expect(
            f.client.begin(f.address.sourceId, position)
        ).rejects.toThrow();
        await expect(
            f.adapter.invoke(f.raw, 'savePlaybackPosition', [
                f.address.sourceId,
                position,
            ])
        ).resolves.toBeUndefined();
        expect(f.saved[f.saved.length - 1]).toEqual(
            expect.objectContaining({
                positionSeconds: 20,
            })
        );
        expect(f.saved[f.saved.length - 1]).not.toHaveProperty(
            'activitySessionId'
        );
        f.setOffline(false);
        await f.client.refresh(f.address.sourceId);
        await expect(
            f.adapter.invoke(f.raw, 'savePlaybackPosition', [
                f.address.sourceId,
                { ...position, positionSeconds: 35 },
            ])
        ).resolves.toBeUndefined();
        expect(f.saved[f.saved.length - 1].positionSeconds).toBe(35);
        expect((await f.store.read(f.address))?.state.owner).toBeNull();
        expect(await f.store.pending()).toHaveLength(0);
        await f.client.begin(f.address.sourceId, position);
        await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...position, positionSeconds: 45 },
        ]);
        await f.client.flush();
        expect(
            (await f.store.read(f.address))?.state.resume?.positionSeconds
        ).toBe(45);
        expect(f.saved[f.saved.length - 1].positionSeconds).toBe(35);
    });

    it.each([false, true])(
        'preserves an imported position over a synchronized reset (watched: %s)',
        async (watched) => {
            const f = fixture();
            const reset = f.setRemote({
                kind: 'reset',
                operationId: 'synthetic-reset',
                deviceId: 'other-device',
                expectedRevision: 0,
            });
            await f.store.mutate(f.address, () => ({
                state: reset,
                pending: [],
            }));
            await f.client.importPosition(f.address.sourceId, {
                ...f.position,
                watched,
            });
            expect((await f.store.read(f.address))?.conflict).toBeDefined();
            expect(
                (await f.client.positions(f.address.sourceId))[0].reset
            ).toBe(false);
            expect(await f.adapter.all(f.raw, f.address.sourceId)).toHaveLength(
                1
            );
            await f.adapter.keepLocal(f.raw, f.address.sourceId);
            await f.client.resolve(f.address, false);
            expect(await f.store.pending()).toHaveLength(0);
            expect(f.saved).toEqual([
                expect.objectContaining({
                    positionSeconds: watched ? 100 : 20,
                    watched,
                }),
            ]);
            expect(f.raw.clearPlaybackPosition).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'ignores retired incarnations when handling the current queue (send: %s)',
        async (send) => {
            localStorage.setItem(
                'iptvnator:source-server',
                JSON.stringify({
                    apiUrl: 'http://synthetic.invalid/api',
                    instanceId: 'synthetic-nas',
                })
            );
            await prepareSourceConnection();
            localStorage.setItem(
                'iptvnator-server:synthetic-nas:activity-consent-v1',
                JSON.stringify({
                    enabled: true,
                    generation: 'current-consent',
                    deviceId: 'synthetic-device',
                })
            );
            const f = fixture();
            const retired = {
                ...f.address,
                sourceIncarnation: 'retired-incarnation',
            };
            const operation: ActivityOperation = {
                kind: 'mark-watched',
                operationId: 'synthetic-watched',
                deviceId: 'synthetic-device',
                expectedRevision: 0,
            };
            for (const address of [retired, f.address])
                await f.store.mutate(address, () => ({
                    state: applyActivityOperation(
                        emptyActivityState(),
                        operation
                    ).state,
                    position: { ...f.position, watched: true },
                    pending: [
                        {
                            address,
                            operation,
                            consentGeneration: 'previous-consent',
                        },
                    ],
                }));
            const runtime = Object.create(
                ActivitySyncRuntime.prototype
            ) as ActivitySyncRuntime;
            Object.assign(runtime, {
                client: f.client,
                adapter: f.adapter,
                raw: f.raw,
                sourceIds: async () => [f.address.sourceId],
                summary: async () => undefined,
                busy: signal(false),
                error: signal(false),
            });
            await runtime.parked(send);
            expect(runtime.error()).toBe(false);
            expect((await f.store.read(f.address))?.pending).toHaveLength(0);
            expect(
                (await f.store.read(retired))?.pending[0].consentGeneration
            ).toBe('previous-consent');
            expect(f.saved).toHaveLength(send ? 0 : 1);
        }
    );
});

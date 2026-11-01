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
import { ActivityLocalOnlyPositions } from './activity-local-only-positions';

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
    const localOnly = new ActivityLocalOnlyPositions(
        'synthetic-nas',
        localStorage
    );
    const client = new ActivitySyncClient(store, {
        committed: (sourceId, position, kind) =>
            localOnly.committed(sourceId, position, kind),
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
    const adapter = new ActivityPositionAdapter(client, undefined, localOnly);
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
    it.each([false, true])(
        'durably clears an unbound offline fallback and retires its old checkpoints (retry: %s)',
        async (failedClear) => {
            const f = fixture();
            f.client.contexts.clear();
            f.setOffline(true);
            const position = {
                ...f.position,
                activitySessionId: 'synthetic-unbound',
            };
            await expect(
                f.client.begin(f.address.sourceId, position)
            ).rejects.toThrow();
            await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
                f.address.sourceId,
                position,
            ]);
            if (failedClear)
                (
                    f.raw.clearPlaybackPosition as jest.Mock
                ).mockRejectedValueOnce(
                    new Error('Synthetic local clear failure')
                );
            const clearing = f.adapter.invoke(f.raw, 'clearPlaybackPosition', [
                f.address.sourceId,
                42,
                'vod',
            ]);
            if (failedClear) {
                await expect(clearing).rejects.toThrow(
                    'Synthetic local clear failure'
                );
                expect(await f.adapter.all(f.raw, f.address.sourceId)).toEqual(
                    []
                );
                const reopened = new ActivityPositionAdapter(
                    f.client,
                    undefined,
                    new ActivityLocalOnlyPositions(
                        'synthetic-nas',
                        localStorage
                    )
                );
                await reopened.keepLocal(f.raw, f.address.sourceId);
            } else await expect(clearing).resolves.toBeUndefined();
            expect(await f.adapter.all(f.raw, f.address.sourceId)).toEqual([]);
            await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
                f.address.sourceId,
                { ...position, positionSeconds: 65 },
            ]);
            expect(await f.adapter.all(f.raw, f.address.sourceId)).toEqual([]);
            expect(await f.store.pending()).toEqual([]);
        }
    );

    it('continues saving locally after an uncached offline launch and recovery', async () => {
        const f = fixture();
        f.setRemote({
            kind: 'begin',
            operationId: 'synthetic-remote-begin',
            expectedRevision: 0,
            deviceId: 'other-device',
            sessionId: 'synthetic-server-session',
        });
        f.setRemote({
            kind: 'checkpoint',
            operationId: 'synthetic-remote-checkpoint',
            generation: 1,
            deviceId: 'other-device',
            sessionId: 'synthetic-server-session',
            sequence: 1,
            resume: { positionSeconds: 30, durationSeconds: 100 },
        });
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
        expect((await f.store.read(f.address))?.state.owner?.sessionId).toBe(
            'synthetic-server-session'
        );
        expect(
            (await f.adapter.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(35);
        await f.adapter.keepLocal(f.raw, f.address.sourceId);
        expect(f.saved[f.saved.length - 1].positionSeconds).toBe(35);
        // Flags survive a renderer/client recreation and do not grant shared ownership.
        const reopenedClient = new ActivitySyncClient(
            f.store,
            f.client.options
        );
        const reopened = new ActivityPositionAdapter(
            reopenedClient,
            undefined,
            new ActivityLocalOnlyPositions('synthetic-nas', localStorage)
        );
        await reopened.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...position, positionSeconds: 45 },
        ]);
        expect(
            (await reopened.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(45);
        await reopened.keepLocal(f.raw, f.address.sourceId);
        expect(f.saved[f.saved.length - 1].positionSeconds).toBe(45);
        expect(
            (await f.store.read(f.address))?.state.resume?.positionSeconds
        ).toBe(30);
        expect(await f.store.pending()).toHaveLength(0);
        await reopenedClient.resolve(f.address, false);
        await reopened.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...position, positionSeconds: 50 },
        ]);
        expect(
            (await reopened.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(30);
        expect(f.saved[f.saved.length - 1].positionSeconds).toBe(45);
        await reopenedClient.begin(f.address.sourceId, position);
        await reopened.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...position, positionSeconds: 55 },
        ]);
        await reopenedClient.flush();
        expect(
            (await f.store.read(f.address))?.state.resume?.positionSeconds
        ).toBe(55);
        expect(
            (await reopened.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(55);
        expect(f.saved[f.saved.length - 1].positionSeconds).toBe(45);
    });

    it.each(['mark-watched', 'reset', 'import', 'server-choice'] as const)(
        'releases local-only ownership after an explicit %s',
        async (action) => {
            const f = fixture();
            f.setRemote({
                kind: 'begin',
                operationId: 'synthetic-begin',
                expectedRevision: 0,
                deviceId: 'other-device',
                sessionId: 'synthetic-session',
            });
            f.setRemote({
                kind: 'checkpoint',
                operationId: 'synthetic-checkpoint',
                generation: 1,
                deviceId: 'other-device',
                sessionId: 'synthetic-session',
                sequence: 1,
                resume: { positionSeconds: 30, durationSeconds: 100 },
            });
            await f.client.refresh(f.address.sourceId);
            const position = { ...f.position, positionSeconds: 45 };
            await f.raw.savePlaybackPosition(f.address.sourceId, position);
            const localOnly = new ActivityLocalOnlyPositions(
                'synthetic-nas',
                localStorage
            );
            localOnly.mark(f.address.sourceId, position);
            if (action === 'mark-watched')
                await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
                    f.address.sourceId,
                    { ...position, activityAction: 'mark-watched' },
                ]);
            else if (action === 'reset')
                await f.adapter.invoke(f.raw, 'clearPlaybackPosition', [
                    f.address.sourceId,
                    42,
                    'vod',
                ]);
            else if (action === 'import')
                await f.client.importPosition(f.address.sourceId, position);
            else await f.client.resolve(f.address, false);
            await f.client.flush();
            expect(localOnly.has(f.address.sourceId, position)).toBe(false);
            const projected = await f.adapter.all(f.raw, f.address.sourceId);
            if (action === 'reset') expect(projected).toHaveLength(0);
            else if (action === 'mark-watched')
                expect(projected[0].watched).toBe(true);
            else
                expect(projected[0].positionSeconds).toBe(
                    action === 'import' ? 45 : 30
                );
        }
    );

    it('keeps an unwatched legacy import below completion when a watched server row conflicts', async () => {
        const f = fixture();
        const remote = f.setRemote({
            kind: 'mark-watched',
            operationId: 'synthetic-watched',
            deviceId: 'synthetic-other',
            expectedRevision: 0,
        });
        await f.store.mutate(f.address, () => ({ state: remote, pending: [] }));
        await f.client.importPosition(f.address.sourceId, {
            ...f.position,
            watched: undefined,
        });
        expect((await f.store.read(f.address))?.conflict).toBeDefined();
        expect(
            (await f.client.positions(f.address.sourceId))[0].position.watched
        ).toBe(false);
        await f.adapter.keepLocal(f.raw, f.address.sourceId);
        expect(f.saved).toEqual([
            expect.objectContaining({
                positionSeconds: 20,
                durationSeconds: 100,
                watched: false,
            }),
        ]);
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

    it('keeps a parked reset local even when its raw position was deleted', async () => {
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
        f.setRemote({
            kind: 'begin',
            operationId: 'synthetic-begin',
            expectedRevision: 0,
            deviceId: 'other-device',
            sessionId: 'synthetic-session',
        });
        const remote = f.setRemote({
            kind: 'checkpoint',
            operationId: 'synthetic-checkpoint',
            generation: 1,
            deviceId: 'other-device',
            sessionId: 'synthetic-session',
            sequence: 1,
            resume: { positionSeconds: 95, durationSeconds: 100 },
        });
        const operation: ActivityOperation = {
            kind: 'reset',
            operationId: 'synthetic-reset',
            expectedRevision: remote.revision,
            deviceId: 'synthetic-device',
        };
        await f.store.mutate(f.address, () => ({
            state: applyActivityOperation(remote, operation).state,
            position: { ...f.position, positionSeconds: 0 },
            pending: [
                {
                    address: f.address,
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
        await runtime.parked(false);
        expect(runtime.error()).toBe(false);
        expect(f.saved).toHaveLength(0);
        expect(await f.adapter.all(f.raw, f.address.sourceId)).toHaveLength(0);
        await f.adapter.keepLocal(f.raw, f.address.sourceId);
        expect(f.saved).toHaveLength(0);
        expect(
            (await f.store.read(f.address))?.state.resume?.positionSeconds
        ).toBe(95);
    });

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
            if (!send) {
                await f.adapter.keepLocal(f.raw, f.address.sourceId);
                expect(f.saved).toHaveLength(1);
                expect(
                    (await f.adapter.all(f.raw, f.address.sourceId))[0].watched
                ).toBe(true);
            }
        }
    );
});

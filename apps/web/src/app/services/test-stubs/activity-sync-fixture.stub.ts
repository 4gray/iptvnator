import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { ActivitySyncClient } from '@iptvnator/services/activity-sync';
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
import { ActivityPositionAdapter } from '../activity-position-adapter';
import { ActivityLocalOnlyPositions } from '../activity-local-only-positions';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function activitySyncFixture() {
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
        failedLaunch: (sourceId, position, _incarnation, preserveLocal) => {
            if (!preserveLocal || !localOnly.has(sourceId, position))
                localOnly.mark(sourceId, position);
        },
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

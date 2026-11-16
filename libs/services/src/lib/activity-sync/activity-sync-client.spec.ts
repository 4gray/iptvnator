import { ActivitySyncClient } from './activity-sync-client';
import { ActivitySupersededError } from './activity-action-fence';
import { MemoryActivityStore } from './test-stubs/memory-activity-store';
import {
    activityAddressKey,
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
    type ActivityApplyResult,
    type ActivityLocalStore,
    type ActivityState,
} from '@iptvnator/shared/interfaces/activity-sync';
import type {
    PlaybackPositionData,
    SourceServerRequest,
} from '@iptvnator/shared/interfaces';

const context = {
    sourceId: 'source',
    provider: 'xtream' as const,
    sourceIncarnation: 'original',
};
const movie = (session: string, seconds = 20): PlaybackPositionData => ({
    playlistId: 'source',
    contentXtreamId: 42,
    contentType: 'vod',
    activitySessionId: session,
    positionSeconds: seconds,
    durationSeconds: 100,
});

function harness(provider: 'xtream' | 'stalker' = 'xtream') {
    const context = {
        sourceId: 'source',
        provider,
        sourceIncarnation: 'original',
    };
    const states = new Map<string, ActivityState>();
    const receipts = new Map<string, ActivityApplyResult>();
    const addresses = new Map<string, ActivityAddress>();
    let offline = false;
    let loseResponse = false;
    const request = jest.fn(async (input: SourceServerRequest) => {
        if (offline) throw new Error('offline');
        if (input.operation === 'activity-context')
            return { status: 200, body: context };
        if (input.operation === 'activity-list')
            return {
                status: 200,
                body: {
                    entries: [...states.entries()].map(([key, state]) => ({
                        address: addresses.get(key),
                        state,
                    })),
                },
            };
        const address = input.activity!.address;
        const key = activityAddressKey(address);
        addresses.set(key, address);
        if (input.operation === 'activity-read')
            return {
                status: 200,
                body: states.get(key) ?? emptyActivityState(),
            };
        const operation = input.activity!.operation!;
        const result =
            receipts.get(operation.operationId) ??
            applyActivityOperation(
                states.get(key) ?? emptyActivityState(),
                operation
            );
        receipts.set(operation.operationId, result);
        if (result.status === 'applied')
            states.set(key, structuredClone(result.state));
        if (loseResponse) {
            loseResponse = false;
            throw new Error('response lost');
        }
        return { status: 200, body: structuredClone(result) };
    });
    function client(
        deviceId: string,
        store: ActivityLocalStore = new MemoryActivityStore()
    ) {
        let consent: string | null = 'consent';
        const status = jest.fn();
        const value = new ActivitySyncClient(store, {
            instanceId: 'nas',
            deviceId,
            contexts: [context],
            consent: () => consent,
            request,
            changed: () => undefined,
            status,
        });
        return {
            value,
            store,
            status,
            consent: (value: string | null) => {
                consent = value;
            },
        };
    }
    return {
        client,
        states,
        receipts,
        request,
        offline: (value: boolean) => {
            offline = value;
        },
        loseResponse: () => {
            loseResponse = true;
        },
    };
}

async function launch(
    client: ReturnType<ReturnType<typeof harness>['client']>,
    position: PlaybackPositionData
) {
    await client.value.begin('source', position);
    await client.value.save('source', position);
}

describe('activity sync clients', () => {
    it.each(['incarnation', 'consent'] as const)(
        'recovers ready status while an old %s queue remains parked',
        async (retired) => {
            const h = harness();
            const a = h.client('synthetic-device');
            await a.value.begin('source', movie('synthetic-session'));
            await a.value.flush();
            h.offline(true);
            await a.value.save('source', movie('synthetic-session', 65));
            await a.value.flush();
            expect(a.status).toHaveBeenLastCalledWith('offline');
            if (retired === 'incarnation')
                a.value.acceptContext({
                    ...context,
                    sourceIncarnation: 'synthetic-replacement',
                });
            else a.consent('synthetic-new-consent');
            h.offline(false);
            if (retired === 'incarnation')
                h.request.mockImplementationOnce(async () => ({
                    status: 200,
                    body: {
                        ...context,
                        sourceIncarnation: 'synthetic-replacement',
                    },
                }));
            await a.value.refresh('source');
            await a.value.flush();
            expect(a.status).toHaveBeenLastCalledWith('ready');
            expect(await a.store.pending()).toHaveLength(1);
        }
    );

    it('retires a failed local launch after its verified source account changes', async () => {
        const h = harness();
        const a = h.client('a');
        a.value.contexts.clear();
        h.offline(true);
        await expect(
            a.value.begin('source', movie('failed'))
        ).rejects.toThrow();
        expect(await a.value.save('source', movie('failed'))).toBe(
            'local-only'
        );
        a.value.acceptContext(context);
        expect(await a.value.save('source', movie('failed'))).toBe(
            'local-only'
        );
        a.value.acceptContext({ ...context, sourceIncarnation: 'replacement' });
        expect(await a.value.save('source', movie('failed'))).toBeUndefined();
        expect(a.value.retiredSessions.has('failed')).toBe(true);
        expect(await a.store.pending()).toEqual([]);
    });

    it('does not clear local ownership when a shared checkpoint finishes after consent pauses', async () => {
        const a = harness().client('synthetic-device');
        await launch(a, movie('synthetic-session', 20));
        await a.value.flush();
        const committed = jest.fn();
        a.value.options.committed = committed;
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const mutate = a.store.mutate.bind(a.store);
        jest.spyOn(a.store, 'mutate').mockImplementationOnce(
            async (address, update) => {
                entered();
                await held;
                return mutate(address, update);
            }
        );
        const saving = a.value.save('source', movie('synthetic-session', 50));
        await started;
        a.consent(null);
        release();
        expect(await saving).toBe('local-only');
        expect(committed).not.toHaveBeenCalled();
    });

    it('ignores old shared checkpoints and aliases after source replacement', async () => {
        const h = harness();
        const a = h.client('a');
        await launch(a, movie('old'));
        await a.value.flush();
        a.value.register('source', [
            {
                ...movie('old'),
                activityIdentity: { provider: 'xtream', kind: 'vod', id: '42' },
            },
        ]);
        a.value.acceptContext({ ...context, sourceIncarnation: 'replacement' });
        expect(a.value.aliases.size).toBe(0);
        await a.value.save('source', movie('old', 65));
        expect(await a.store.pending()).toEqual([]);
        expect(a.value.retiredSessions.has('old')).toBe(true);
    });

    it.each(['regular', 'embedded', 'lazy'] as const)(
        'imports a mirrored Stalker %s reset without creating resume activity',
        async (mode) => {
            const h = harness('stalker');
            const a = h.client('synthetic-device');
            const position: PlaybackPositionData = {
                contentType: 'episode',
                contentXtreamId: 101,
                seriesXtreamId: 100,
                positionSeconds: 0,
                durationSeconds: 0,
                watched: false,
                activityIdentity: {
                    provider: 'stalker',
                    kind: 'episode',
                    seriesId: '100',
                    id: 'synthetic-episode',
                    mode,
                    seasonKey: '1',
                    episodeNumber: 1,
                },
            };
            await a.value.importPosition('source', position);
            await a.value.flush();
            expect([...h.states.values()][0].resume).toBeNull();
            expect((await a.value.positions('source'))[0]).toMatchObject({
                reset: true,
                position: { activityIdentity: position.activityIdentity },
            });
        }
    );

    it.each(['regular', 'embedded', 'lazy'] as const)(
        'preserves scoped metadata on a first Stalker %s reset before other clients open the series',
        async (mode) => {
            const h = harness('stalker');
            const a = h.client('a');
            const b = h.client('b');
            const position: PlaybackPositionData = {
                contentType: 'episode',
                contentXtreamId: 1001,
                seriesXtreamId: 100,
                seasonNumber: 2,
                episodeNumber: 3,
                positionSeconds: 95,
                durationSeconds: 100,
                activityIdentity: {
                    provider: 'stalker',
                    kind: 'episode',
                    mode,
                    seriesId: '100',
                    id: '77',
                    seasonKey: '2',
                    episodeNumber: 3,
                },
            };
            await a.value.reset('source', position);
            await a.value.flush();
            expect([...h.states.values()][0].positionMetadata).toEqual(
                expect.objectContaining({
                    contentXtreamId: 1001,
                    seriesXtreamId: 100,
                    seasonNumber: 2,
                    episodeNumber: 3,
                })
            );
            await b.value.refresh('source');
            expect((await b.value.positions('source'))[0]).toMatchObject({
                reset: true,
                position: {
                    contentXtreamId: 1001,
                    seriesXtreamId: 100,
                    seasonNumber: 2,
                    episodeNumber: 3,
                    positionSeconds: 0,
                },
            });
        }
    );

    it.each([
        ['reset', false],
        ['reset', true],
        ['owner', false],
        ['owner', true],
    ] as const)(
        'does not reclaim a %s from a recreated renderer (fresh cache: %s)',
        async (change, refresh) => {
            const h = harness();
            const a = h.client('a');
            const b = h.client('b');
            await launch(a, movie('external', 25));
            await a.value.flush();
            await b.value.refresh('source');
            if (change === 'reset') await b.value.reset('source', movie('b'));
            else await launch(b, movie('remote', 30));
            await b.value.flush();
            const before = structuredClone([...h.states.values()][0]);
            const reopened = h.client('a', a.store);
            if (refresh) await reopened.value.refresh('source');
            await reopened.value.save('source', movie('external', 70));
            await reopened.value.flush();
            expect([...h.states.values()][0]).toEqual(before);
            expect(await a.store.pending()).toHaveLength(0);
            await launch(reopened, movie('new-explicit-launch', 40));
            await reopened.value.flush();
            expect([...h.states.values()][0].resume?.positionSeconds).toBe(40);
        }
    );
    it('recovers an owned durable session without another begin', async () => {
        const h = harness();
        const a = h.client('a');
        await launch(a, movie('external', 25));
        await a.value.flush();
        const reopened = h.client('a', a.store);
        await reopened.value.save('source', movie('external', 50));
        await reopened.value.flush();
        expect([...h.states.values()][0]).toMatchObject({
            generation: 1,
            owner: { sessionId: 'external' },
            resume: { positionSeconds: 50 },
        });
    });
    it('does not manufacture a launch for an unknown player callback', async () => {
        const h = harness();
        const a = h.client('a');
        await a.value.save('source', movie('unknown', 70));
        await a.value.flush();
        expect(h.states.size).toBe(0);
        expect(await a.store.entries('source')).toHaveLength(0);
    });

    it('timestamps offline saves and retains an already watched local projection', async () => {
        const h = harness();
        const a = h.client('a');
        h.offline(true);
        const before = Date.now();
        await launch(a, {
            ...movie('offline', 95),
            watched: false,
            updatedAt: '2001-01-01T00:00:00.000Z',
        });
        await a.value.save('source', {
            ...movie('offline', 30),
            watched: false,
        });
        const position = (await a.value.positions('source'))[0].position;
        expect(Date.parse(position.updatedAt!)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(position.updatedAt!)).toBeLessThanOrEqual(Date.now());
        expect(position.watched).toBe(true);
        expect(h.states.size).toBe(0);
        expect((await a.store.pending()).length).toBeGreaterThan(0);
    });
    it('lets the originating tab rebase its fresh online begin before a sibling can send it', async () => {
        const h = harness();
        const a = h.client('same-device');
        const sibling = h.client('same-device', a.store);
        const remote = h.client('other-device');
        await launch(remote, movie('remote', 30));
        await remote.value.flush();
        const held = jest.spyOn(a.value, 'flush').mockResolvedValue(undefined);
        await launch(a, movie('new-online', 40));
        await sibling.value.flush();
        expect(
            (await a.store.entries('source'))[0].record.conflict
        ).toBeUndefined();
        held.mockRestore();
        await a.value.flush();
        expect([...h.states.values()][0]).toMatchObject({
            owner: { sessionId: 'new-online' },
            resume: { positionSeconds: 40 },
        });
        expect(await a.store.pending()).toHaveLength(0);
    });
    it('lets the originating tab retire a superseded live checkpoint instead of creating a sibling conflict', async () => {
        const h = harness();
        const a = h.client('same-device');
        const sibling = h.client('same-device', a.store);
        const remote = h.client('other-device');
        await launch(a, movie('old-live', 20));
        await a.value.flush();
        await launch(remote, movie('remote', 30));
        await remote.value.flush();
        const held = jest.spyOn(a.value, 'flush').mockResolvedValue(undefined);
        await a.value.save('source', movie('old-live', 70));
        await sibling.value.flush();
        expect(
            (await a.store.entries('source'))[0].record.conflict
        ).toBeUndefined();
        held.mockRestore();
        await a.value.flush();
        expect(await a.store.pending()).toHaveLength(0);
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(30);
    });
    it('recovers an expired originating-tab lease as offline intent without rebasing it automatically', async () => {
        const h = harness();
        const a = h.client('same-device');
        const sibling = h.client('same-device', a.store);
        const remote = h.client('other-device');
        const held = jest.spyOn(a.value, 'flush').mockResolvedValue(undefined);
        await launch(a, movie('abandoned', 70));
        await launch(remote, movie('remote', 30));
        await remote.value.flush();
        const clock = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.now() + 60_000);
        try {
            await sibling.value.flush();
        } finally {
            clock.mockRestore();
            held.mockRestore();
        }
        expect(
            (await a.store.entries('source'))[0].record.conflict
        ).toBeDefined();
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(30);
        await a.value.flush();
    });
    it('keeps a native checkpoint after an older web position is acknowledged late', async () => {
        const h = harness();
        const { value, store } = h.client('synthetic-device');
        const position = movie('synthetic-session', 20);
        await value.begin('source', position);
        await value.flush();
        const held = jest.spyOn(value, 'flush').mockResolvedValue(undefined);
        await value.save('source', position);
        const captured = Date.now() + 1000;
        const nativeCheckpointAt = new Date(captured).toISOString();
        const acknowledgedAt = new Date(captured + 1000).toISOString();
        const send = h.request.getMockImplementation()!;
        h.request.mockImplementation(async (input) => {
            const response = await send(input);
            if (input.activity?.operation?.kind === 'checkpoint') {
                const result = response.body as ActivityApplyResult;
                result.state.updatedAt = acknowledgedAt;
            }
            return response;
        });
        held.mockRestore();
        await value.flush();

        const [previous] = await value.positions('source');
        expect(previous.position.updatedAt).toBe(acknowledgedAt);
        expect(Date.parse(previous.position.activityPlayedAt!)).toBeLessThan(
            captured
        );
        await value.save('source', {
            ...position,
            positionSeconds: 35,
            nativeCheckpointAt,
        });
        await value.flush();

        const [{ record }] = await store.entries('source');
        expect(record.position).toMatchObject({
            positionSeconds: 35,
            updatedAt: acknowledgedAt,
            activityPlayedAt: nativeCheckpointAt,
        });
    });

    it.each([false, true])(
        'keeps newer progress when an older server drops capture time (refresh: %s)',
        async (refresh) => {
            const h = harness();
            const { value } = h.client('synthetic-device');
            const send = h.request.getMockImplementation()!;
            h.request.mockImplementation((input) => {
                const operation = input.activity?.operation;
                if (
                    !input.activity ||
                    operation?.kind !== 'checkpoint' ||
                    !operation.positionMetadata
                )
                    return send(input);
                const positionMetadata = { ...operation.positionMetadata };
                delete positionMetadata.playedAt;
                return send({
                    ...input,
                    activity: {
                        ...input.activity,
                        operation: { ...operation, positionMetadata },
                    },
                });
            });
            const position = movie('synthetic-session', 80);
            await value.begin('source', position);
            await value.flush();
            const nativeCheckpointAt = new Date(
                Date.now() - 1000
            ).toISOString();
            await value.save('source', position);
            await value.flush();
            if (refresh) await value.refresh('source');

            await value.save('source', {
                ...position,
                positionSeconds: 20,
                nativeCheckpointAt,
            });
            await value.flush();
            expect([...h.states.values()][0].resume?.positionSeconds).toBe(80);
        }
    );

    it('saves a native position captured before the server acknowledged begin', async () => {
        const h = harness();
        const { value } = h.client('synthetic-device');
        const position = movie('synthetic-session', 0);
        const nativeCheckpointAt = new Date(Date.now() - 1000).toISOString();
        const acknowledgedAt = new Date().toISOString();
        const send = h.request.getMockImplementation()!;
        h.request.mockImplementation(async (input) => {
            const response = await send(input);
            if (input.activity?.operation?.kind === 'begin') {
                const result = response.body as ActivityApplyResult;
                result.state.updatedAt = acknowledgedAt;
            }
            return response;
        });
        await value.begin('source', position);
        await value.flush();
        expect((await value.positions('source'))[0].position.updatedAt).toBe(
            acknowledgedAt
        );

        await value.save('source', {
            ...position,
            nativeCheckpointAt,
            positionSeconds: 35,
        });
        await value.flush();

        expect([...h.states.values()][0].resume?.positionSeconds).toBe(35);
    });

    it.each([false, true])(
        'retries a native checkpoint displaced by a reset (reset succeeded: %s)',
        async (resetSucceeded) => {
            const h = harness();
            const { value, store } = h.client('synthetic-device');
            const position = movie('synthetic-session', 35);
            await value.begin('source', position);
            await value.flush();

            let entered!: () => void;
            const waiting = new Promise<void>((resolve) => {
                entered = resolve;
            });
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const mutate = store.mutate.bind(store);
            const writes = jest
                .spyOn(store, 'mutate')
                .mockImplementationOnce(async (...args) => {
                    entered();
                    await held;
                    return mutate(...args);
                });
            if (!resetSucceeded)
                writes.mockRejectedValueOnce(
                    new Error('Synthetic reset failure')
                );

            const checkpoint = {
                ...position,
                nativeCheckpointAt: new Date(Date.now() + 1000).toISOString(),
            };
            const saving = value.save('source', checkpoint);
            await waiting;
            try {
                const reset = value.reset('source', position);
                if (resetSucceeded) await reset;
                else
                    await expect(reset).rejects.toThrow(
                        'Synthetic reset failure'
                    );
            } finally {
                release();
            }
            await expect(saving).rejects.toBeInstanceOf(
                ActivitySupersededError
            );
            await value.save('source', checkpoint);
            await value.flush();
            expect([...h.states.values()][0].resume?.positionSeconds).toBe(
                resetSucceeded ? undefined : 35
            );
        }
    );

    it('keeps a native checkpoint queued if its activity address is superseded', async () => {
        const h = harness();
        const { value, store } = h.client('synthetic-device');
        const position = movie('synthetic-session', 35);
        await value.begin('source', position);
        await value.flush();

        const { value: restarted } = h.client('synthetic-device', store);
        jest.spyOn(restarted, 'address').mockRejectedValueOnce(
            new ActivitySupersededError('Synthetic context superseded')
        );
        const checkpoint = {
            ...position,
            nativeCheckpointAt: new Date().toISOString(),
        };
        await expect(
            restarted.save('source', checkpoint)
        ).rejects.toBeInstanceOf(ActivitySupersededError);
        await restarted.save('source', checkpoint);
        await restarted.flush();
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(35);
    });

    it('preserves the stored title when recovering a native checkpoint after a restart', async () => {
        const h = harness();
        const { value, store } = h.client('synthetic-device');
        const position = movie('synthetic-session', 35);
        const activityTitle = 'Synthetic movie';
        await value.begin('source', { ...position, activityTitle });
        await value.flush();

        const { value: restarted } = h.client('synthetic-device', store);
        await restarted.save('source', {
            ...position,
            nativeCheckpointAt: new Date(Date.now() + 1000).toISOString(),
        });
        await restarted.flush();

        const [{ record }] = await store.entries('source');
        expect(record.position).toMatchObject({
            activityTitle,
            positionSeconds: 35,
        });
        expect([...h.states.values()][0].positionMetadata?.title).toBe(
            activityTitle
        );
    });

    it('queues Mark watched while the inherited native checkpoint is pending', async () => {
        const h = harness();
        const { value, store } = h.client('synthetic-device');
        const position = movie('synthetic-session', 35);
        await value.begin('source', position);
        await value.flush();

        const held = jest.spyOn(value, 'flush').mockResolvedValue(undefined);
        try {
            await value.save('source', {
                ...position,
                nativeCheckpointAt: new Date(Date.now() + 1000).toISOString(),
            });
            const [{ position: pending }] = await value.positions('source');
            expect(pending.watched).toBe(false);
            await value.save('source', {
                ...pending,
                positionSeconds: position.durationSeconds!,
                activitySessionId: undefined,
                activityAction: 'mark-watched',
            });
            expect(
                (await store.pending()).map(({ operation }) => operation.kind)
            ).toEqual(['checkpoint', 'mark-watched']);
        } finally {
            held.mockRestore();
        }

        await value.flush();
        expect([...h.states.values()][0]).toMatchObject({
            watched: true,
            watchedOrigin: 'manual',
        });
    });

    it('renews a fresh tab lease while its request is slow', async () => {
        const h = harness();
        const a = h.client('same-device');
        const sibling = h.client('same-device', a.store);
        const remote = h.client('other-device');
        await launch(remote, movie('remote', 30));
        await remote.value.flush();
        const send = h.request.getMockImplementation()!;
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        let held = false;
        h.request.mockImplementation(async (input) => {
            if (
                !held &&
                input.operation === 'activity-apply' &&
                input.activity?.operation?.deviceId === 'same-device'
            ) {
                held = true;
                await blocked;
            }
            return send(input);
        });
        jest.useFakeTimers();
        try {
            await launch(a, movie('slow-online', 40));
            await jest.advanceTimersByTimeAsync(20_000);
            await sibling.value.flush();
            expect(
                (await a.store.entries('source'))[0].record.conflict
            ).toBeUndefined();
        } finally {
            release();
            await a.value.flush();
            jest.useRealTimers();
        }
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(40);
        expect(await a.store.pending()).toHaveLength(0);
    });
    it('claims delivery against the current store when the list snapshot contains an expired lease', async () => {
        const h = harness();
        const a = h.client('same-device');
        const remote = h.client('other-device');
        await launch(remote, movie('remote', 30));
        await remote.value.flush();
        const held = jest.spyOn(a.value, 'flush').mockResolvedValue(undefined);
        await launch(a, movie('new-online', 40));
        const stale = structuredClone(await a.store.entries('source'));
        for (const entry of stale)
            for (const pending of entry.record.pending)
                if (pending.deliveryLease)
                    pending.deliveryLease.expiresAt = Date.now() - 1;
        const store: ActivityLocalStore = {
            entries: async () => stale,
            read: a.store.read.bind(a.store),
            pending: a.store.pending.bind(a.store),
            mutate: a.store.mutate.bind(a.store),
        };
        await h.client('same-device', store).value.flush();
        expect(
            (await a.store.entries('source'))[0].record.conflict
        ).toBeUndefined();
        held.mockRestore();
        await a.value.flush();
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(40);
    });
    it('keeps a newer explicit online launch fresh behind its prior live checkpoint', async () => {
        const h = harness();
        const a = h.client('a');
        const remote = h.client('b');
        await launch(a, movie('old-live', 20));
        await a.value.flush();
        const held = jest.spyOn(a.value, 'flush').mockResolvedValue(undefined);
        await a.value.save('source', movie('old-live', 70));
        await launch(a, movie('new-online', 40));
        await launch(remote, movie('remote', 30));
        await remote.value.flush();
        held.mockRestore();
        await a.value.flush();
        expect(
            (await a.store.entries('source'))[0].record.conflict
        ).toBeUndefined();
        expect([...h.states.values()][0]).toMatchObject({
            owner: { sessionId: 'new-online' },
            resume: { positionSeconds: 40 },
        });
        expect(await a.store.pending()).toHaveLength(0);
    });
    it('sends no requests without consent and imports no existing local data', async () => {
        const h = harness();
        const a = h.client('a');
        a.consent(null);
        await a.value.refresh('source');
        await a.value.flush();
        expect(h.request).not.toHaveBeenCalled();
    });
    it('shares progress, automatic watched and a durable reset', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        await launch(a, movie('a', 35));
        await a.value.flush();
        await b.value.refresh('source');
        expect(
            (await b.value.positions('source'))[0].position.positionSeconds
        ).toBe(35);
        await a.value.save('source', movie('a', 95));
        await a.value.flush();
        await b.value.refresh('source');
        expect((await b.value.positions('source'))[0].position.watched).toBe(
            true
        );
        await b.value.reset('source', movie('b'));
        await b.value.flush();
        await a.value.refresh('source');
        expect((await a.value.positions('source'))[0].reset).toBe(true);
    });
    it('gives the latest live launch ownership and refuses an older tick', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        await launch(a, movie('a', 25));
        await a.value.flush();
        await launch(b, movie('b', 50));
        await b.value.flush();
        await a.value.save('source', movie('a', 70));
        await a.value.flush();
        expect([...h.states.values()][0].owner?.deviceId).toBe('b');
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(50);
        expect(await a.store.pending()).toHaveLength(0);
        await a.value.save('source', movie('a', 75));
        expect(await a.store.pending()).toHaveLength(0);
    });
    it('recovers a lost acknowledgement across restart without replaying begin', async () => {
        const h = harness();
        const a = h.client('a');
        h.loseResponse();
        await launch(a, movie('a', 25));
        await a.value.flush();
        await h.client('a', a.store).value.flush();
        expect([...h.states.values()][0].generation).toBe(1);
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(25);
        expect(await a.store.pending()).toHaveLength(0);
    });
    it.each([false, true])(
        'keeps local playback unwatched after an offline reset conflicts with a server watched mark (previously watched: %s)',
        async (wasWatched) => {
            const h = harness();
            const a = h.client('synthetic-a');
            const b = h.client('synthetic-b');
            await launch(a, movie('synthetic-original', wasWatched ? 95 : 30));
            await a.value.flush();
            await b.value.refresh('source');
            h.offline(true);
            await a.value.reset('source', movie('synthetic-original'));
            await launch(a, movie('synthetic-resumed', 20));
            await a.value.flush();
            h.offline(false);
            await b.value.save('source', {
                ...movie('synthetic-other'),
                activitySessionId: undefined,
                activityAction: 'mark-watched',
                watched: true,
            });
            await b.value.flush();
            await a.value.flush();
            const entry = (await a.store.entries('source'))[0];
            expect(entry.record.conflict).toBeDefined();
            expect(entry.record.position?.watched).toBe(false);
            await a.value.resolve(entry.address, true);
            expect([...h.states.values()][0]).toMatchObject({
                watched: false,
                watchedOrigin: null,
                resume: { positionSeconds: 20 },
            });
            expect(
                (await a.value.positions('source'))[0].position.watched
            ).toBe(false);
            await a.value.save('source', movie('synthetic-resumed', 45));
            await a.value.flush();
            expect([...h.states.values()][0]).toMatchObject({
                watched: false,
                resume: { positionSeconds: 45 },
            });
            expect(await a.store.pending()).toEqual([]);
        }
    );

    it('keeps competing offline progress until an explicit local/server choice', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        h.offline(true);
        await launch(a, movie('a', 65));
        await a.value.flush();
        h.offline(false);
        await launch(b, movie('b', 30));
        await b.value.flush();
        await a.value.flush();
        const entry = (await a.store.entries('source'))[0];
        expect(entry.record.conflict).toBeDefined();
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(30);
        await a.value.resolve(entry.address, true);
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(65);
        await a.value.save('source', {
            ...movie('a', 25),
            nativeCheckpointAt: new Date(
                Date.parse(entry.record.position!.activityPlayedAt!) - 1000
            ).toISOString(),
        });
        await a.value.flush();
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(65);
        await a.value.save('source', movie('a', 70));
        await a.value.flush();
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(70);
    });
    it.each(['reset', 'mark-watched'] as const)(
        'keeps a resolved local %s terminal after obsolete offline session callbacks',
        async (action) => {
            const h = harness();
            const a = h.client('a');
            const b = h.client('b');
            h.offline(true);
            await launch(a, movie('synthetic-old-one', 20));
            await launch(a, movie('synthetic-old-two', 30));
            if (action === 'reset')
                await a.value.reset('source', movie('synthetic-old-two'));
            else
                await a.value.save('source', {
                    ...movie('synthetic-old-two'),
                    activitySessionId: undefined,
                    activityAction: 'mark-watched',
                    watched: true,
                });
            await a.value.flush();
            await a.value.stopDelivery();
            h.offline(false);
            await launch(b, movie('synthetic-competing', 40));
            await b.value.flush();
            await a.value.flush();
            const entry = (await a.store.entries('source'))[0];
            expect(entry.record.conflict).toBeDefined();
            await a.value.resolve(entry.address, true);
            expect(await a.store.pending()).toEqual([]);
            const resolved = (await a.store.read(entry.address))!.state;
            for (const id of ['synthetic-old-one', 'synthetic-old-two']) {
                await a.value.save('source', movie(id, 80));
                await a.value.flush();
            }
            expect((await a.store.read(entry.address))?.state).toEqual(
                resolved
            );
            expect(
                (await a.store.read(entry.address))?.conflict
            ).toBeUndefined();
            expect(await a.store.pending()).toEqual([]);
        }
    );

    it('parks old consent generations', async () => {
        const h = harness();
        const a = h.client('a');
        h.offline(true);
        await launch(a, movie('a', 25));
        await a.value.flush();
        a.consent('new');
        h.offline(false);
        await a.value.flush();
        expect(h.states.size).toBe(0);
        expect((await a.store.pending())[0].consentGeneration).toBe('consent');
    });
    it.each([1, 2])(
        'retires discarded offline sessions after choosing a server owner with equal or lower generation (%s begins)',
        async (begins) => {
            const h = harness();
            const a = h.client('a');
            const b = h.client('b');
            h.offline(true);
            for (let index = 1; index <= begins; index++) {
                await launch(a, movie(`offline-${index}`, 65));
                await a.value.flush();
            }
            h.offline(false);
            await launch(b, movie('online', 30));
            await b.value.flush();
            await a.value.flush();
            const entry = (await a.store.entries('source'))[0];
            expect(entry.record.conflict).toBeDefined();
            await a.value.resolve(entry.address, false);
            await a.value.save('source', movie(`offline-${begins}`, 80));
            await a.value.flush();
            expect(await a.store.pending()).toHaveLength(0);
            expect(
                (await a.store.entries('source'))[0].record.conflict
            ).toBeUndefined();
            expect([...h.states.values()][0].resume?.positionSeconds).toBe(30);
            await launch(a, movie('explicit-new-session', 40));
            await a.value.flush();
            expect([...h.states.values()][0].resume?.positionSeconds).toBe(40);
        }
    );
    describe.each([
        {
            seconds: 65.25,
            duration: 100.5,
            resume: { positionSeconds: 65, durationSeconds: 100 },
        },
        { seconds: 65.25, duration: Infinity, resume: { positionSeconds: 65 } },
        { seconds: 0.25, duration: 0.75, resume: { positionSeconds: 0 } },
    ])(
        'fractional snapshots ($seconds / $duration)',
        ({ seconds, duration, resume }) => {
            const position = {
                ...movie('offline', seconds),
                durationSeconds: duration,
            };
            it('normalizes the local choice after an offline conflict', async () => {
                const h = harness();
                const a = h.client('a');
                const b = h.client('b');
                h.offline(true);
                await launch(a, position);
                await a.value.flush();
                h.offline(false);
                await launch(b, movie('online', 30));
                await b.value.flush();
                await a.value.flush();
                const entry = (await a.store.entries('source'))[0];
                expect(entry.record.conflict).toBeDefined();
                await a.value.resolve(entry.address, true);
                expect([...h.states.values()][0].resume).toEqual(resume);
                expect(await a.store.pending()).toHaveLength(0);
            });
            it('normalizes an explicit local import', async () => {
                const h = harness();
                const a = h.client('a');
                await a.value.importPosition('source', position);
                expect([...h.states.values()][0].resume).toEqual(resume);
                expect(await a.store.pending()).toHaveLength(0);
            });
        }
    );
    it('leaves explicitly imported server collisions for a choice', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        await launch(a, movie('a', 25));
        await a.value.flush();
        await b.value.refresh('source');
        await b.value.importPosition('source', {
            ...movie('b', 80),
            activitySessionId: undefined,
        });
        expect([...h.states.values()][0].resume?.positionSeconds).toBe(25);
        expect(
            (await b.store.entries('source'))[0].record.conflict
        ).toBeDefined();
    });
    it('preserves an offline checkpoint conflict and applies an explicit server choice without resurrecting a reset', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        await launch(a, movie('a', 20));
        await a.value.flush();
        h.offline(true);
        await a.value.save('source', movie('a', 75));
        await a.value.flush();
        h.offline(false);
        await b.value.refresh('source');
        await b.value.reset('source', movie('b'));
        await b.value.flush();
        await a.value.flush();
        const entry = (await a.store.entries('source'))[0];
        expect(entry.record.position?.positionSeconds).toBe(75);
        expect(entry.record.conflict?.resume).toBeNull();
        await a.value.resolve(entry.address, false);
        await a.value.save('source', movie('a', 80));
        await a.value.flush();
        expect(await a.store.pending()).toHaveLength(0);
        expect([...h.states.values()][0]).toMatchObject({
            resume: null,
            watched: false,
        });
    });
    it('keeps the chosen offline completed position as well as its watched mark', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        h.offline(true);
        await launch(a, movie('a', 95));
        await a.value.flush();
        h.offline(false);
        await launch(b, movie('b', 30));
        await b.value.flush();
        await a.value.flush();
        const entry = (await a.store.entries('source'))[0];
        await a.value.resolve(entry.address, true);
        expect([...h.states.values()][0]).toMatchObject({
            resume: { positionSeconds: 95 },
            watched: true,
        });
    });
    it.each(['regular', 'embedded', 'lazy'] as const)(
        'maps Stalker %s episodes through the full identity even when local tracking ids differ',
        async (mode) => {
            const h = harness('stalker');
            const a = h.client('a');
            const b = h.client('b');
            const activityIdentity = {
                provider: 'stalker' as const,
                kind: 'episode' as const,
                seriesId: 'provider-parent',
                id: 'episode-1',
                mode,
                seasonKey: 'provider-season',
                episodeNumber: 1,
            };
            const episode = {
                ...movie('a', 45),
                contentType: 'episode' as const,
                seriesXtreamId: 999,
                contentXtreamId: 111,
                activityIdentity,
            };
            await launch(a, episode);
            await a.value.flush();
            b.value.register('source', [
                { ...episode, contentXtreamId: 222, seriesXtreamId: 888 },
            ]);
            await b.value.refresh('source');
            expect(
                (await b.value.positions('source'))[0].position
            ).toMatchObject({
                contentXtreamId: 222,
                seriesXtreamId: 888,
                positionSeconds: 45,
                activityIdentity,
            });
            await b.value.save('source', {
                ...episode,
                contentXtreamId: 222,
                activitySessionId: undefined,
                activityAction: 'mark-watched',
            });
            await b.value.flush();
            await a.value.refresh('source');
            expect(
                (await a.value.positions('source'))[0].position.watched
            ).toBe(true);
        }
    );
    it('keeps an ambiguous legacy Stalker hash local instead of choosing a provider episode', async () => {
        const h = harness('stalker');
        const client = h.client('a');
        const base = {
            ...movie('a'),
            contentType: 'episode' as const,
            seriesXtreamId: 10,
        };
        const identity = {
            provider: 'stalker' as const,
            kind: 'episode' as const,
            mode: 'lazy' as const,
            seriesId: 'parent',
            id: 'first',
            seasonKey: '1',
            episodeNumber: 1,
        };
        client.value.register('source', [
            { ...base, activityIdentity: identity },
            {
                ...base,
                activityIdentity: {
                    ...identity,
                    id: 'second',
                    episodeNumber: 2,
                },
            },
        ]);
        await expect(
            client.value.importPosition('source', base)
        ).rejects.toThrow('Activity identity unavailable');
        expect(h.states.size).toBe(0);
    });
    it('does not let a late player callback block a reset waiting for the server', async () => {
        const h = harness();
        const a = h.client('a');
        await launch(a, movie('a', 20));
        await a.value.flush();
        h.offline(true);
        await a.value.reset('source', movie('a'));
        await a.value.flush();
        await a.value.save('source', movie('a', 95));
        await a.value.flush();
        const entry = (await a.store.entries('source'))[0];
        expect(entry.record.conflict).toBeUndefined();
        expect(
            entry.record.pending.map((intent) => intent.operation.kind)
        ).toEqual(['reset']);
        h.offline(false);
        await a.value.flush();
        expect(await a.store.pending()).toHaveLength(0);
        expect([...h.states.values()][0]).toMatchObject({
            resume: null,
            watched: false,
        });
    });
});

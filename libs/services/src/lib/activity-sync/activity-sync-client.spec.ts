import { ActivitySyncClient } from './activity-sync-client';
import {
    activityAddressKey,
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
    type ActivityApplyResult,
    type ActivityLocalRecord,
    type ActivityLocalStore,
    type ActivityState,
    type ActivityPendingOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import type {
    PlaybackPositionData,
    SourceServerRequest,
} from '@iptvnator/shared/interfaces';

class MemoryActivityStore implements ActivityLocalStore {
    private rows = new Map<
        string,
        { address: ActivityAddress; record: ActivityLocalRecord }
    >();
    private tail = Promise.resolve();
    async read(address: ActivityAddress) {
        await this.tail;
        return structuredClone(
            this.rows.get(activityAddressKey(address))?.record ?? null
        );
    }
    async entries(sourceId: string) {
        await this.tail;
        return structuredClone(
            [...this.rows.values()].filter(
                (row) => row.address.sourceId === sourceId
            )
        );
    }
    async pending() {
        await this.tail;
        return [...this.rows.values()].reduce<ActivityPendingOperation[]>(
            (all, row) => all.concat(row.record.pending),
            []
        );
    }
    mutate(
        address: ActivityAddress,
        change: (current: ActivityLocalRecord | null) => ActivityLocalRecord
    ): Promise<ActivityLocalRecord> {
        const operation = this.tail.then(() => {
            const key = activityAddressKey(address);
            const next = change(
                structuredClone(this.rows.get(key)?.record ?? null)
            );
            this.rows.set(key, structuredClone({ address, record: next }));
            return structuredClone(next);
        });
        this.tail = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }
}
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
    });
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

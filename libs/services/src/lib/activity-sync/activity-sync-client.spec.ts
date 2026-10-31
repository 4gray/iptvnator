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
    function client(deviceId: string, store = new MemoryActivityStore()) {
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

describe('activity sync clients', () => {
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
        await a.value.save('source', movie('a', 35));
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
        await a.value.save('source', movie('a', 25));
        await a.value.flush();
        await b.value.save('source', movie('b', 50));
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
        await a.value.save('source', movie('a', 25));
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
        await a.value.save('source', movie('a', 65));
        await a.value.flush();
        h.offline(false);
        await b.value.save('source', movie('b', 30));
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
        await a.value.save('source', movie('a', 25));
        await a.value.flush();
        a.consent('new');
        h.offline(false);
        await a.value.flush();
        expect(h.states.size).toBe(0);
        expect((await a.store.pending())[0].consentGeneration).toBe('consent');
    });
    it('leaves explicitly imported server collisions for a choice', async () => {
        const h = harness();
        const a = h.client('a');
        const b = h.client('b');
        await a.value.save('source', movie('a', 25));
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
        await a.value.save('source', movie('a', 20));
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
        await a.value.save('source', movie('a', 95));
        await a.value.flush();
        h.offline(false);
        await b.value.save('source', movie('b', 30));
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
            await a.value.save('source', episode);
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
        await a.value.save('source', movie('a', 20));
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

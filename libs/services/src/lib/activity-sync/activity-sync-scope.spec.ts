import { ActivitySyncClient } from './activity-sync-client';
import { MemoryActivityStore } from './test-stubs/memory-activity-store';
import {
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import type {
    PlaybackPositionData,
    SourceServerRequest,
} from '@iptvnator/shared/interfaces';

const KIDS: PersonalScope = 'profile:11111111-1111-4111-8111-111111111111';
const context = {
    sourceId: 'source',
    provider: 'xtream' as const,
    sourceIncarnation: 'original',
};
const content = { provider: 'xtream' as const, kind: 'vod' as const, id: '42' };
const address = (scope: PersonalScope): ActivityAddress => ({
    instanceId: 'nas',
    scope,
    sourceId: 'source',
    sourceIncarnation: 'original',
    content,
});
const record = (seconds: number) => ({
    state: emptyActivityState(),
    position: {
        playlistId: 'source',
        contentXtreamId: 42,
        contentType: 'vod',
        positionSeconds: seconds,
        durationSeconds: 100,
    } as PlaybackPositionData,
    pending: [],
});

function build(scope?: PersonalScope, listed: ActivityAddress[] = []) {
    const store = new MemoryActivityStore();
    const request = jest.fn(async (input: SourceServerRequest) =>
        input.operation === 'activity-list'
            ? {
                  status: 200,
                  body: {
                      entries: listed.map((a) => ({
                          address: a,
                          state: { ...emptyActivityState(), revision: 1 },
                      })),
                  },
              }
            : { status: 200, body: context }
    );
    const status = jest.fn();
    const client = new ActivitySyncClient(store, {
        instanceId: 'nas',
        deviceId: 'device',
        contexts: [context],
        consent: () => 'consent',
        request,
        changed: () => undefined,
        status,
        ...(scope ? { scope } : {}),
    });
    return { client, store, request, status };
}

describe('activity scope', () => {
    it('addresses writes to the Default profile unless a scope is given', async () => {
        const position = { contentXtreamId: 42, contentType: 'vod' as const };
        expect((await build().client.address('source', position)).scope).toBe(
            'shared'
        );
        expect(
            (await build(KIDS).client.address('source', position)).scope
        ).toBe(KIDS);
    });

    it('asks for the scope on a profile list and adds nothing for the Default profile', async () => {
        const kids = build(KIDS);
        await kids.client.refresh('source');
        expect(
            kids.request.mock.calls.find(
                ([r]) => r.operation === 'activity-list'
            )![0].scope
        ).toBe(KIDS);
        const home = build();
        await home.client.refresh('source');
        const list = home.request.mock.calls.find(
            ([r]) => r.operation === 'activity-list'
        )![0];
        expect('scope' in list).toBe(false);
    });

    it('refuses a list entry from another scope', async () => {
        const { client, store, status } = build(KIDS, [address('shared')]);
        await client.refresh('source');
        expect(status).toHaveBeenCalledWith('offline');
        expect(await store.entries('source')).toEqual([]);
    });

    it('returns only its own scope from positions', async () => {
        const { client, store } = build(KIDS);
        await store.mutate(address('shared'), () => record(10));
        await store.mutate(address(KIDS), () => record(55));
        const rows = await client.positions('source');
        expect(rows.map((r) => r.position.positionSeconds)).toEqual([55]);
        const home = build();
        await home.store.mutate(address('shared'), () => record(10));
        await home.store.mutate(address(KIDS), () => record(55));
        expect(
            (await home.client.positions('source')).map(
                (r) => r.position.positionSeconds
            )
        ).toEqual([10]);
    });
});

describe('activity delivery across scopes', () => {
    const reset = (id: string) => ({
        kind: 'reset' as const,
        operationId: id,
        deviceId: 'device',
        expectedRevision: 0,
    });
    async function queue(refusal: 'profile_missing' | 'profiles_disabled') {
        const store = new MemoryActivityStore();
        const status = jest.fn();
        const request = jest.fn(async (input: SourceServerRequest) => {
            if (input.operation !== 'activity-apply')
                return { status: 200, body: context };
            const { address, operation } = input.activity!;
            return address.scope === KIDS
                ? { status: 409, body: { code: refusal } }
                : {
                      status: 200,
                      body: applyActivityOperation(
                          emptyActivityState(),
                          operation!
                      ),
                  };
        });
        const client = new ActivitySyncClient(store, {
            instanceId: 'nas',
            deviceId: 'device',
            contexts: [context],
            consent: () => 'consent',
            request,
            changed: () => undefined,
            status,
        });
        for (const scope of [KIDS, 'shared'] as const)
            await store.mutate(address(scope), () => ({
                ...record(1),
                pending: [
                    {
                        address: address(scope),
                        operation: reset(`op-${scope}`),
                        consentGeneration: 'consent',
                    },
                ],
            }));
        await client.flush();
        return { store, status };
    }

    it('drops a deleted profile queue and still delivers the others', async () => {
        const { store, status } = await queue('profile_missing');
        expect(await store.pending()).toEqual([]);
        expect(status).not.toHaveBeenCalledWith('offline');
        expect(status).toHaveBeenLastCalledWith('ready');
    });

    it('keeps a switched-off scope queue, unleased, and still delivers the others', async () => {
        const { store, status } = await queue('profiles_disabled');
        const left = await store.pending();
        expect(left.map((p) => p.address.scope)).toEqual([KIDS]);
        expect(left[0].deliveryLease).toBeUndefined();
        expect(status).not.toHaveBeenCalledWith('offline');
        expect(status).toHaveBeenLastCalledWith('ready');
    });
});

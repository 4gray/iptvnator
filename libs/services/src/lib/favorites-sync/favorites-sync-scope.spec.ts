import { webcrypto } from 'node:crypto';
import { FavoritesSyncClient } from './favorites-sync-client';
import {
    applyFavoriteOperation,
    emptyFavoriteState,
    favoriteAddressKey,
    type FavoriteAddress,
    type FavoriteLocalRecord,
    type FavoriteLocalStore,
    type FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import type { SourceServerRequest } from '@iptvnator/shared/interfaces';

const KIDS: PersonalScope = 'profile:11111111-1111-4111-8111-111111111111';
const source: FavoriteSourceContext = {
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const ref = { provider: 'xtream' as const, kind: 'movie' as const, id: '42' };

class MemoryStore implements FavoriteLocalStore {
    rows = new Map<
        string,
        { address: FavoriteAddress; record: FavoriteLocalRecord }
    >();
    async read(a: FavoriteAddress) {
        return this.rows.get(favoriteAddressKey(a))?.record ?? null;
    }
    async entries(sourceId: string) {
        return [...this.rows.values()].filter(
            (row) => row.address.sourceId === sourceId
        );
    }
    async pending() {
        return [...this.rows.values()].flatMap((row) => row.record.pending);
    }
    async mutate(
        a: FavoriteAddress,
        change: (c: FavoriteLocalRecord | null) => FavoriteLocalRecord
    ) {
        const record = change(
            this.rows.get(favoriteAddressKey(a))?.record ?? null
        );
        this.rows.set(favoriteAddressKey(a), { address: a, record });
        return record;
    }
}

function build(
    store: MemoryStore,
    scope?: PersonalScope,
    listed: FavoriteAddress[] = []
) {
    const request = jest.fn(async (input: SourceServerRequest) =>
        input.operation === 'favorites-context'
            ? { status: 200, body: source }
            : {
                  status: 200,
                  body: {
                      entries: listed.map((address) => ({
                          address,
                          state: { revision: 1, member: true },
                      })),
                  },
              }
    );
    const client = new FavoritesSyncClient(store, {
        instanceId: 'nas',
        deviceId: 'device',
        consent: () => null,
        request,
        contexts: [source],
        remember: jest.fn(),
        changed: jest.fn(),
        ...(scope ? { scope } : {}),
    });
    return { client, request };
}
const addressOf = (scope: PersonalScope): FavoriteAddress => ({
    instanceId: 'nas',
    scope,
    ...source,
    content: ref,
});

beforeAll(() =>
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    })
);

describe('favorites scope', () => {
    it('addresses a favorite to its own scope', () => {
        const store = new MemoryStore();
        expect(build(store).client.address(source, ref).scope).toBe('shared');
        expect(build(store, KIDS).client.address(source, ref).scope).toBe(KIDS);
    });

    it('lists only its own scope and keeps the Default request unchanged', async () => {
        const store = new MemoryStore();
        const kids = new FavoritesSyncClient(store, {
            ...build(store, KIDS).client.options,
            consent: () => 'consent',
        });
        await kids.refresh('source', false);
        const list = (kids.options.request as jest.Mock).mock.calls.find(
            ([r]) => r.operation === 'favorites-list'
        )![0];
        expect(list.scope).toBe(KIDS);
        const home = build(store);
        const homeClient = new FavoritesSyncClient(store, {
            ...home.client.options,
            consent: () => 'consent',
        });
        await homeClient.refresh('source', false);
        const homeList = (
            homeClient.options.request as jest.Mock
        ).mock.calls.find(([r]) => r.operation === 'favorites-list')![0];
        expect('scope' in homeList).toBe(false);
    });

    it('refuses a list entry from another scope', async () => {
        const store = new MemoryStore();
        const { client } = build(store, KIDS, [addressOf('shared')]);
        const refusing = new FavoritesSyncClient(store, {
            ...client.options,
            consent: () => 'consent',
        });
        await expect(refusing.refresh('source', false)).rejects.toThrow(
            'Favorite scope mismatch'
        );
        expect(store.rows.size).toBe(0);
    });

    it('returns only its own scope from entries', async () => {
        const store = new MemoryStore();
        const home = build(store).client;
        const kids = build(store, KIDS).client;
        await home.setLocal('source', ref, true);
        await kids.setLocal('source', { ...ref, id: '43' }, true);
        expect(
            (await home.entries('source')).map((e) => e.address.content)
        ).toEqual([ref]);
        expect(
            (await kids.entries('source')).map((e) => e.address.scope)
        ).toEqual([KIDS]);
    });
});

describe('favorites delivery across scopes', () => {
    async function queued(refusal: 'profile_missing' | 'profiles_disabled') {
        const store = new MemoryStore();
        let online = false;
        const request = jest.fn(async (input: SourceServerRequest) => {
            if (!online) throw new Error('offline');
            if (input.operation === 'favorites-context')
                return { status: 200, body: source };
            const { address, operation } = input.favorite!;
            return address.scope === KIDS
                ? { status: 409, body: { code: refusal } }
                : {
                      status: 200,
                      body: applyFavoriteOperation(
                          emptyFavoriteState(),
                          operation!
                      ),
                  };
        });
        const make = (scope?: PersonalScope) =>
            new FavoritesSyncClient(store, {
                instanceId: 'nas',
                deviceId: 'device',
                consent: () => 'consent',
                request,
                contexts: [source],
                remember: jest.fn(),
                changed: jest.fn(),
                ...(scope ? { scope } : {}),
            });
        const kids = make(KIDS);
        const home = make();
        await kids.set('source', ref, true);
        await home.set('source', { ...ref, id: '43' }, true);
        online = true;
        await home.flush().catch(() => undefined);
        return { store, home };
    }

    it('drops a deleted profile queue and still delivers the Default queue', async () => {
        const { store, home } = await queued('profile_missing');
        await expect(home.flush()).resolves.toBeUndefined();
        expect(await store.pending()).toEqual([]);
    });

    it('keeps a switched-off scope queue and still delivers the Default queue', async () => {
        const { store, home } = await queued('profiles_disabled');
        await expect(home.flush()).resolves.toBeUndefined();
        expect((await store.pending()).map((p) => p.address.scope)).toEqual([
            KIDS,
        ]);
    });
});

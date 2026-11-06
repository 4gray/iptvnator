import { webcrypto } from 'node:crypto';
import { FavoritesSyncClient } from './favorites-sync-client';
import {
    applyFavoriteOperation,
    emptyFavoriteState,
    favoriteAddressKey,
    assertFavoriteLocalRecord,
    type FavoriteAddress,
    type FavoriteLocalRecord,
    type FavoriteLocalStore,
    type FavoriteSourceContext,
    type FavoriteState,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { SourceServerRequest } from '@iptvnator/shared/interfaces';
const source: FavoriteSourceContext = {
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const ref = { provider: 'xtream' as const, kind: 'movie' as const, id: '42' };
const address: FavoriteAddress = {
    instanceId: 'nas',
    scope: 'shared',
    ...source,
    content: ref,
};
class MemoryStore implements FavoriteLocalStore {
    readonly rows = new Map<
        string,
        { address: FavoriteAddress; record: FavoriteLocalRecord }
    >();
    beforeMutation?: () => void;
    async read(a: FavoriteAddress) {
        return structuredClone(
            this.rows.get(favoriteAddressKey(a))?.record ?? null
        );
    }
    async entries(sourceId: string) {
        return structuredClone(
            [...this.rows.values()].filter(
                (row) => row.address.sourceId === sourceId
            )
        );
    }
    async pending() {
        return (await this.entries('source')).reduce<
            import('@iptvnator/shared/interfaces/favorites-sync').FavoritePending[]
        >((all, row) => all.concat(row.record.pending), []);
    }
    async mutate(
        a: FavoriteAddress,
        change: (current: FavoriteLocalRecord | null) => FavoriteLocalRecord
    ) {
        this.beforeMutation?.();
        const record = change(
            structuredClone(
                this.rows.get(favoriteAddressKey(a))?.record ?? null
            )
        );
        assertFavoriteLocalRecord(a, record);
        this.rows.set(
            favoriteAddressKey(a),
            structuredClone({ address: a, record })
        );
        return record;
    }
}
function fixture() {
    const local = new MemoryStore();
    let consent: string | null = 'consent-1';
    let online = true;
    let incarnation = 'first';
    let active = true;
    const states = new Map<string, FavoriteState>();
    const receipts = new Map<string, unknown>();
    const requests: SourceServerRequest[] = [];
    let afterApply: (() => Promise<void>) | undefined;
    let applyFailure: Error | number | undefined;
    const request = async (input: SourceServerRequest) => {
        requests.push(input);
        if (!online) throw new Error('offline');
        if (input.operation === 'favorites-context')
            return {
                status: 200,
                body: { ...source, sourceIncarnation: incarnation },
            };
        if (input.operation === 'favorites-list')
            return {
                status: 200,
                body: {
                    entries: [...states].map(([key, state]) =>
                        (() => {
                            const [
                                instanceId,
                                scope,
                                sourceId,
                                sourceIncarnation,
                                content,
                            ] = JSON.parse(key);
                            return {
                                address: {
                                    instanceId,
                                    scope,
                                    sourceId,
                                    sourceIncarnation,
                                    content,
                                },
                                state,
                            };
                        })()
                    ),
                },
            };
        if (applyFailure instanceof Error) throw applyFailure;
        if (applyFailure !== undefined) return { status: applyFailure };
        const a = input.favorite!.address;
        const operation = input.favorite!.operation!;
        if (a.sourceIncarnation !== incarnation) return { status: 409 };
        const key = favoriteAddressKey(a);
        const receiptKey = operation.deviceId + ':' + operation.operationId;
        let result = receipts.get(receiptKey);
        if (!result) {
            result = applyFavoriteOperation(
                states.get(key) ?? emptyFavoriteState(),
                operation
            );
            receipts.set(receiptKey, result);
            if ((result as { status: string }).status === 'applied')
                states.set(key, (result as { state: FavoriteState }).state);
        }
        await afterApply?.();
        return { status: 200, body: result };
    };
    const options = {
        instanceId: 'nas',
        deviceId: 'device',
        consent: () => consent,
        request,
        contexts: [source],
        profileActive: () => active,
        remember: jest.fn(),
        changed: jest.fn(),
    };
    const client = new FavoritesSyncClient(local, options);
    return {
        local,
        client,
        options,
        states,
        receipts,
        requests,
        consent: (value: string | null) => (consent = value),
        online: (value: boolean) => (online = value),
        incarnation: (value: string) => (incarnation = value),
        active: (value: boolean) => (active = value),
        afterApply: (value: () => Promise<void>) => (afterApply = value),
        applyFailure: (value: Error | number | undefined) =>
            (applyFailure = value),
    };
}
beforeAll(() =>
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    })
);
describe('favorites delivery and consent boundaries', () => {
    it.each([
        { ...source, sourceId: 'synthetic-other' },
        { ...source, sourceIncarnation: '' },
        { ...source, provider: 'synthetic' },
    ])(
        'rejects invalid source verification without guessing a new link (%j)',
        async (body) => {
            const f = fixture();
            f.options.request = async () => ({ status: 200, body }) as never;
            expect(await f.client.context('source')).toEqual(source);
            f.client.forget('source');
            await expect(f.client.context('source')).rejects.toThrow(
                'Invalid favorite source'
            );
            expect(await f.client.entries('source')).toEqual([]);
            f.consent(null);
            expect(() => f.client.generation()).toThrow();
        }
    );
    it('retains the newest accepted verification when an older request confirms the same incarnation', async () => {
        const f = fixture();
        let finish!: (value: { status: number; body: typeof source }) => void;
        let calls = 0;
        f.options.request = () =>
            ++calls === 1
                ? (new Promise((resolve) => (finish = resolve)) as never)
                : Promise.resolve({ status: 200, body: { ...source } });
        const first = f.client.context('source');
        const latest = await f.client.context('source');
        finish({ status: 200, body: { ...source } });
        expect(await first).toBe(latest);
        expect(f.options.remember).toHaveBeenCalledTimes(1);
    });

    it.each([500, 502, 503, 504, 599])(
        'queues an edit against a verified cached context on HTTP %s and delivers after recovery',
        async (status) => {
            const f = fixture();
            const request = f.options.request;
            f.options.request = async () => ({ status });
            await f.client.set('source', ref, true);
            expect((await f.local.read(address))?.state.member).toBe(true);
            expect(await f.local.pending()).toHaveLength(1);
            f.options.request = request;
            await f.client.refresh('source');
            expect(await f.local.pending()).toHaveLength(0);
            expect(f.states.get(favoriteAddressKey(address))?.member).toBe(
                true
            );
        }
    );
    it('does not guess an unverified source context during HTTP 503', async () => {
        const f = fixture();
        f.client.forget('source');
        f.options.request = async () => ({ status: 503 });
        await expect(f.client.set('source', ref, true)).rejects.toThrow();
        expect(f.local.rows.size).toBe(0);
    });
    it.each(['consent', 'profile', 'source', 'newer-context'])(
        'rejects cached HTTP 503 fallback after %s ownership changes',
        async (change) => {
            const f = fixture();
            f.options.request = async () => {
                if (change === 'consent') f.consent(null);
                if (change === 'profile') f.active(false);
                if (change === 'source') f.client.forget('source');
                if (change === 'newer-context') {
                    f.options.request = async () => ({
                        status: 200,
                        body: { ...source, sourceIncarnation: 'second' },
                    });
                    await f.client.context('source');
                }
                return { status: 503 };
            };
            await expect(f.client.set('source', ref, true)).rejects.toThrow();
            expect(f.local.rows.size).toBe(0);
        }
    );
    it.each([401, 503, new Error('Synthetic network failure')])(
        'reports an operations-only failure while retaining the durable intent (%s)',
        async (failure) => {
            const f = fixture();
            f.applyFailure(failure);
            await f.client.set('source', ref, true);
            await expect(f.client.refresh('source')).rejects.toThrow();
            expect(await f.local.pending()).toHaveLength(1);
            expect((await f.local.read(address))?.state.member).toBe(true);
            f.applyFailure(undefined);
            await f.client.refresh('source');
            expect(await f.local.pending()).toHaveLength(0);
        }
    );
    it.each([false, true])(
        'retains newer polled state when an old conflict receipt is retried (useLocal=%s)',
        async (useLocal) => {
            const f = fixture();
            const key = favoriteAddressKey(address);
            f.states.set(key, { revision: 2, member: false });
            f.afterApply(async () => {
                throw new Error('Synthetic lost response');
            });
            await f.client.set('source', ref, false);
            expect((await f.local.read(address))?.pending).toHaveLength(1);
            f.states.set(key, { revision: 3, member: true });
            f.afterApply(async () => undefined);
            await f.client.refresh('source');
            expect((await f.local.read(address))?.base).toEqual({
                revision: 3,
                member: true,
            });
            expect((await f.local.read(address))?.conflict).toEqual({
                revision: 3,
                member: true,
            });
            await f.client.resolve(address, useLocal);
            expect((await f.local.read(address))?.state).toEqual({
                revision: useLocal ? 4 : 3,
                member: !useLocal,
            });
            expect((await f.local.read(address))?.pending).toEqual([]);
        }
    );
    it.each([false, true])(
        'resolves the latest server conflict after polling (useLocal=%s)',
        async (useLocal) => {
            const f = fixture();
            f.online(false);
            await f.client.set('source', ref, true);
            f.states.set(favoriteAddressKey(address), {
                revision: 2,
                member: false,
            });
            f.online(true);
            await f.client.refresh('source');
            expect((await f.local.read(address))?.conflict?.revision).toBe(2);
            f.states.set(favoriteAddressKey(address), {
                revision: 3,
                member: true,
            });
            await f.client.refresh('source');
            expect((await f.local.read(address))?.conflict).toEqual({
                revision: 3,
                member: true,
            });
            await f.client.resolve(address, useLocal);
            expect((await f.local.read(address))?.state).toEqual({
                revision: useLocal ? 4 : 3,
                member: true,
            });
            expect((await f.local.read(address))?.conflict).toBeUndefined();
            expect((await f.local.read(address))?.pending).toEqual([]);
        }
    );
    it('discards a local projection read after profile or incarnation ownership changes', async () => {
        for (const boundary of ['profile', 'source']) {
            const f = fixture();
            const read = f.client.entries('source');
            if (boundary === 'profile') f.active(false);
            else f.client.forget('source');
            await expect(read).rejects.toThrow();
        }
    });
    it('enabling receives shared state without uploading older local data or synthesizing removals', async () => {
        const f = fixture();
        f.states.set(favoriteAddressKey(address), {
            revision: 1,
            member: true,
        });
        await f.client.refresh('source');
        expect((await f.local.read(address))?.state).toEqual({
            revision: 1,
            member: true,
        });
        expect(
            f.requests.some(
                (request) => request.operation === 'favorites-apply'
            )
        ).toBe(false);
    });
    it('commits an offline add and remove atomically, then delivers in order after restart', async () => {
        const f = fixture();
        f.online(false);
        await f.client.set('source', ref, true);
        await f.client.set('source', ref, false);
        expect((await f.local.read(address))?.state.member).toBe(false);
        expect((await f.local.pending()).length).toBe(2);
        f.online(true);
        await new FavoritesSyncClient(f.local, f.options).refresh('source');
        expect(f.states.get(favoriteAddressKey(address))).toEqual({
            revision: 2,
            member: false,
        });
        expect(await f.local.pending()).toHaveLength(0);
    });
    it('parks an accepted operation with a lost acknowledgement and safely retries its receipt', async () => {
        const f = fixture();
        f.afterApply(async () => {
            throw new Error('lost acknowledgement');
        });
        await f.client.set('source', ref, true);
        expect(await f.local.pending()).toHaveLength(1);
        f.consent(null);
        f.consent('consent-2');
        f.afterApply(async () => undefined);
        await f.client.refresh('source');
        expect(await f.local.pending()).toHaveLength(1);
        expect(f.receipts.size).toBe(1);
        await f.client.parked('source', true);
        expect(await f.local.pending()).toHaveLength(0);
        expect(f.states.get(favoriteAddressKey(address))?.revision).toBe(1);
    });
    it('keeps pending changes local only after explicit choice', async () => {
        const f = fixture();
        f.online(false);
        await f.client.set('source', ref, true);
        f.consent('consent-2');
        f.online(true);
        await f.client.refresh('source');
        await f.client.parked('source', false);
        expect(f.states.size).toBe(0);
        expect((await f.local.read(address))?.local).toMatchObject({
            member: true,
        });
        expect((await f.local.read(address))?.localOnly).toBe(true);
        expect(await f.local.pending()).toHaveLength(0);
    });
    it('preserves both choices for a same-item stale offline edit', async () => {
        const f = fixture();
        f.online(false);
        await f.client.set('source', ref, true);
        f.states.set(favoriteAddressKey(address), {
            revision: 2,
            member: false,
        });
        f.online(true);
        await f.client.refresh('source');
        expect((await f.local.read(address))?.conflict).toEqual({
            revision: 2,
            member: false,
        });
        expect((await f.local.read(address))?.state.member).toBe(true);
        await f.client.resolve(address, true);
        expect(f.states.get(favoriteAddressKey(address))).toEqual({
            revision: 3,
            member: true,
        });
    });
    it('does not overwrite the server during explicit import of conflicting local favorites', async () => {
        const f = fixture();
        f.states.set(favoriteAddressKey(address), {
            revision: 2,
            member: false,
        });
        await f.client.refresh('source');
        await f.client.set(
            'source',
            ref,
            true,
            { title: 'Synthetic item' },
            true
        );
        expect(f.states.get(favoriteAddressKey(address))?.member).toBe(false);
        expect((await f.local.read(address))?.state.member).toBe(true);
        expect((await f.local.read(address))?.conflict?.revision).toBe(2);
        await f.client.resolve(address, false);
        expect((await f.local.read(address))?.state.member).toBe(false);
    });
    it('merges independent items even when their context requests overlap', async () => {
        const f = fixture();
        await Promise.all([
            f.client.set('source', ref, true),
            f.client.set('source', { ...ref, id: '43' }, true),
        ]);
        await f.client.flush();
        expect(
            [...f.states.values()].filter((state) => state.member)
        ).toHaveLength(2);
    });
    it('persists independent overlapping offline edits against a verified context', async () => {
        const f = fixture();
        f.online(false);
        const results = await Promise.allSettled(
            [42, 43, 44].map((id) =>
                f.client.set('source', { ...ref, id: String(id) }, false)
            )
        );
        expect(results.map((result) => result.status)).toEqual([
            'fulfilled',
            'fulfilled',
            'fulfilled',
        ]);
        expect(await f.local.pending()).toHaveLength(3);
        expect(
            (await f.client.entries('source')).every(
                (entry) => !entry.record.state.member
            )
        ).toBe(true);
    });
    it('rejects a consent change on a retry before the projection/outbox commit', async () => {
        const f = fixture();
        f.local.beforeMutation = () => f.consent(null);
        await expect(f.client.set('source', ref, true)).rejects.toThrow();
        expect(f.local.rows.size).toBe(0);
        expect(f.states.size).toBe(0);
    });
    it('does not apply a late acknowledgement after opt-out and preserves a newer local removal', async () => {
        const f = fixture();
        f.afterApply(async () => {
            f.consent(null);
            await f.client.setLocal('source', ref, false);
        });
        await expect(
            f.client.set('source', ref, true)
        ).resolves.toBeUndefined();
        expect((await f.local.read(address))?.state.member).toBe(false);
        expect((await f.local.read(address))?.local?.member).toBe(false);
        expect(await f.local.pending()).toHaveLength(1);
    });
    it('leaves old-incarnation queues parked and never sends them into a recreated source', async () => {
        const f = fixture();
        f.online(false);
        await f.client.set('source', ref, true);
        f.online(true);
        f.incarnation('second');
        await f.client.refresh('source');
        expect(f.states.size).toBe(0);
        expect(await f.client.entries('source')).toHaveLength(0);
        expect(await f.local.pending()).toHaveLength(1);
    });
    it.each([401, 403, 404, 409])(
        'does not use a cached context after HTTP %s',
        async (status) => {
            const f = fixture();
            f.options.request = async () => ({ status });
            await expect(f.client.set('source', ref, true)).rejects.toThrow();
            expect(f.local.rows.size).toBe(0);
        }
    );
    it('fences a profile change even for disabled local actions', async () => {
        const f = fixture();
        f.consent(null);
        f.active(false);
        await expect(f.client.setLocal('source', ref, true)).rejects.toThrow();
        expect(f.local.rows.size).toBe(0);
    });
    it('rejects an old displayed reference when its context read discovers a new source incarnation', async () => {
        const f = fixture();
        f.incarnation('second');
        await expect(f.client.set('source', ref, true)).rejects.toThrow();
        expect(f.states.size).toBe(0);
        expect(f.local.rows.size).toBe(0);
    });
    it('rechecks the per-item action fence when an older conflict choice reaches its mutation', async () => {
        const f = fixture();
        f.states.set(favoriteAddressKey(address), {
            revision: 2,
            member: false,
        });
        await f.client.refresh('source');
        let newer: Promise<void> | undefined;
        f.local.beforeMutation = () => {
            f.local.beforeMutation = undefined;
            newer = f.client.set('source', ref, false);
        };
        await expect(f.client.resolve(address, true)).rejects.toThrow();
        await newer;
        expect(f.states.get(favoriteAddressKey(address))?.member).toBe(false);
    });

    it('makes repeated explicit imports a no-op when the server already has that membership', async () => {
        const f = fixture();
        await f.client.set(
            'source',
            ref,
            true,
            { title: 'Synthetic item' },
            true
        );
        await f.client.set(
            'source',
            ref,
            true,
            { title: 'Synthetic item' },
            true
        );
        expect(f.states.get(favoriteAddressKey(address))?.revision).toBe(1);
        expect(f.receipts.size).toBe(1);
    });
    it('deduplicates identical offline imports before delivery without creating a conflict with itself', async () => {
        const f = fixture();
        f.online(false);
        await f.client.set(
            'source',
            ref,
            true,
            {
                title: 'Synthetic imported item',
                tmdbId: '100',
                releaseYear: '2024',
            },
            true
        );
        await f.client.set(
            'source',
            ref,
            true,
            {
                releaseYear: '2024',
                tmdbId: '100',
                title: 'Synthetic imported item',
            },
            true
        );
        expect((await f.local.read(address))?.pending).toHaveLength(1);
        f.online(true);
        await f.client.refresh('source');
        const saved = await f.local.read(address);
        expect(saved?.pending).toHaveLength(0);
        expect(saved?.conflict).toBeUndefined();
        expect(f.states.get(favoriteAddressKey(address))?.revision).toBe(1);
    });
});

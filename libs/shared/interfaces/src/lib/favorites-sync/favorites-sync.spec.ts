import { webcrypto } from 'node:crypto';
import {
    applyFavoriteOperation,
    emptyFavoriteState,
    m3uFavoriteReference,
} from './favorites-sync.reducer';
import {
    favoriteReferenceKey,
    parseFavoriteAddress,
    parseFavoriteOperation,
    assertFavoriteLocalRecord,
} from './favorites-sync.validation';
import type {
    FavoriteAddress,
    FavoriteOperation,
} from './favorites-sync.contract';
const address: FavoriteAddress = {
    instanceId: 'synthetic-nas',
    scope: 'shared',
    sourceId: 'source',
    sourceIncarnation: 'first',
    content: { provider: 'xtream', kind: 'movie', id: '42' },
};
const add: FavoriteOperation = {
    operationId: 'add',
    deviceId: 'device',
    expectedRevision: 0,
    member: true,
};
describe('portable favorites protocol', () => {
    it('retains a revisioned negative state and rejects stale resurrection', () => {
        const added = applyFavoriteOperation(emptyFavoriteState(), add).state;
        const removed = applyFavoriteOperation(added, {
            ...add,
            operationId: 'remove',
            expectedRevision: 1,
            member: false,
        }).state;
        expect(removed).toEqual({ revision: 2, member: false });
        expect(applyFavoriteOperation(removed, add)).toEqual({
            status: 'conflict',
            state: removed,
        });
    });
    it('distinguishes provider type and all Stalker series modes', () => {
        const keys = ['regular', 'embedded', 'lazy'].map((mode) =>
            favoriteReferenceKey({
                provider: 'stalker',
                kind: 'series',
                id: '42',
                mode: mode as 'regular',
            })
        );
        keys.push(
            favoriteReferenceKey({
                provider: 'stalker',
                kind: 'movie',
                id: '42',
            })
        );
        keys.push(
            favoriteReferenceKey({
                provider: 'xtream',
                kind: 'movie',
                id: '42',
            })
        );
        expect(new Set(keys).size).toBe(5);
    });
    it('allowlists snapshots and addresses instead of carrying credentials or playback data', () => {
        expect(
            parseFavoriteAddress({
                ...address,
                token: 'synthetic-secret',
                content: { ...address.content, cmd: 'synthetic-command' },
            })
        ).toEqual(address);
        const parsed = parseFavoriteOperation({
            ...add,
            snapshot: {
                title: 'Synthetic item',
                categoryId: '7',
                cmd: 'synthetic-command',
                url: 'https://fixture.invalid/media',
                token: 'synthetic-secret',
            },
        } as unknown as FavoriteOperation);
        expect(parsed.snapshot).toEqual({
            title: 'Synthetic item',
            categoryId: '7',
        });
        expect(
            parseFavoriteOperation({
                ...add,
                snapshot: { title: 'Synthetic item', tmdbId: null },
            } as unknown as FavoriteOperation).snapshot
        ).toEqual({ title: 'Synthetic item' });
    });
    it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid revision %s',
        (expectedRevision) => {
            expect(() =>
                parseFavoriteOperation({ ...add, expectedRevision })
            ).toThrow();
        }
    );
    it.each([
        { provider: 'stalker', kind: 'series', id: '42' },
        { provider: 'stalker', kind: 'movie', id: '42', mode: 'lazy' },
        { provider: 'm3u', version: 1, urlHash: 'short' },
        { provider: 'xtream', kind: 'radio', id: '42' },
    ])('rejects ambiguous reference %j', (content) => {
        expect(() => parseFavoriteAddress({ ...address, content })).toThrow();
    });
    it('rejects cross-address, duplicate and malformed outbox entries', () => {
        const intent = {
            address,
            consentGeneration: 'consent',
            operation: add,
        };
        const record = {
            state: emptyFavoriteState(),
            base: emptyFavoriteState(),
            pending: [intent],
        };
        expect(() => assertFavoriteLocalRecord(address, record)).not.toThrow();
        expect(() =>
            assertFavoriteLocalRecord(address, {
                ...record,
                pending: [intent, intent],
            })
        ).toThrow();
        expect(() =>
            assertFavoriteLocalRecord(address, {
                ...record,
                pending: [
                    { ...intent, address: { ...address, sourceId: 'other' } },
                ],
            })
        ).toThrow();
    });
    it('preserves exact URL membership with a versioned private hash', async () => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: webcrypto,
        });
        const first = await m3uFavoriteReference(
            'https://fixture.invalid/stream/42'
        );
        expect(first).toEqual(
            await m3uFavoriteReference('https://fixture.invalid/stream/42')
        );
        expect(first).not.toEqual(
            await m3uFavoriteReference('https://fixture.invalid/stream/43')
        );
        expect(JSON.stringify(first)).not.toContain('fixture.invalid');
    });
});

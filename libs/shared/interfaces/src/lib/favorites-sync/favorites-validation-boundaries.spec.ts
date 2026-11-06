import {
    assertFavoriteLocalRecord,
    assertFavoriteState,
    parseFavoriteAddress,
    parseFavoriteReference,
    parseFavoriteSnapshot,
} from './favorites-sync.validation';
import type {
    FavoriteLocalRecord,
    FavoriteSnapshot,
    FavoriteState,
} from './favorites-sync.contract';

const address = {
    instanceId: 'synthetic-instance',
    scope: 'shared' as const,
    sourceId: 'synthetic-source',
    sourceIncarnation: 'first',
    content: { provider: 'xtream' as const, kind: 'movie' as const, id: '42' },
};

describe('favorites protocol trust boundaries', () => {
    it.each([
        null,
        {},
        { provider: 'synthetic' },
        { provider: 'xtream', kind: 'movie', id: '0' },
        { provider: 'xtream', kind: 'movie', id: '9007199254740992' },
        { provider: 'stalker', kind: 'movie', id: 'synthetic/path' },
        { provider: 'stalker', kind: 'series', id: '42', mode: 'synthetic' },
    ])('rejects malformed provider reference %j', (value) => {
        expect(() => parseFavoriteReference(value)).toThrow();
    });
    it.each([
        null,
        { ...address, scope: 'synthetic' },
        { ...address, instanceId: '' },
        { ...address, sourceId: '' },
        { ...address, sourceIncarnation: '' },
    ])('rejects malformed ownership %j', (value) => {
        expect(() => parseFavoriteAddress(value)).toThrow();
    });
    it.each([
        null,
        { title: 7 },
        { title: 'x'.repeat(513) },
        { title: 'synthetic\nitem' },
        { categoryId: 'x'.repeat(129) },
        { tmdbId: '-1' },
        { releaseYear: '9007199254740992' },
        { identityConflict: 'true' },
        { episodes: '1' },
        { episodes: Array(2001).fill(1) },
        { episodes: [-1] },
        { episodes: [0.5] },
    ])('rejects unsafe snapshot fields %#', (value) => {
        expect(() =>
            parseFavoriteSnapshot(value as FavoriteSnapshot)
        ).toThrow();
    });
    it('copies safe episode metadata and both identity conflict values without retaining caller arrays', () => {
        const episodes = [0, 2];
        for (const identityConflict of [false, true]) {
            const parsed = parseFavoriteSnapshot({
                title: 'Synthetic item',
                tmdbId: '42',
                releaseYear: '2026',
                identityConflict,
                episodes,
            });
            expect(parsed).toEqual({
                title: 'Synthetic item',
                tmdbId: '42',
                releaseYear: '2026',
                identityConflict,
                episodes: [0, 2],
            });
            expect(parsed.episodes).not.toBe(episodes);
        }
    });
    it.each([
        null,
        { revision: 1, member: 'true' },
        { revision: 1, member: true, snapshot: { episodes: [-1] } },
    ])('rejects malformed persisted state %j', (value) => {
        expect(() => assertFavoriteState(value as FavoriteState)).toThrow();
    });
    it('validates retained local and conflicting snapshots and refuses a non-array outbox', () => {
        const state = { revision: 0, member: false };
        expect(() =>
            assertFavoriteLocalRecord(address, {
                state,
                base: state,
                local: state,
                conflict: state,
                pending: [],
            })
        ).not.toThrow();
        for (const field of ['local', 'conflict'])
            expect(() =>
                assertFavoriteLocalRecord(address, {
                    state,
                    base: state,
                    pending: [],
                    [field]: { revision: -1, member: false },
                })
            ).toThrow();
        expect(() =>
            assertFavoriteLocalRecord(address, {
                state,
                base: state,
                pending: null,
            } as unknown as FavoriteLocalRecord)
        ).toThrow('Invalid favorite outbox');
    });
});

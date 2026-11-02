import { extractStalkerItemType } from '@iptvnator/shared/interfaces';
import { webcrypto } from 'node:crypto';
import {
    playlistFavorite,
    stalkerFavorite,
} from './favorites-reference-adapters';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import { FavoritesXtreamAdapter } from './favorites-xtream-adapter';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type {
    FavoriteReference,
    FavoriteEntry,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
const playlist = (favorites: Playlist['favorites']) =>
    ({
        _id: 'source',
        title: 'Synthetic source',
        favorites,
        playlist: {
            items: [
                {
                    id: 'one',
                    url: 'https://fixture.invalid/one',
                    name: 'Synthetic one',
                },
                {
                    id: 'two',
                    url: 'https://fixture.invalid/one',
                    name: 'Synthetic duplicate',
                },
                { id: 'ambiguous', url: 'https://fixture.invalid/three' },
                { id: 'ambiguous', url: 'https://fixture.invalid/four' },
            ],
        },
    }) as Playlist;
beforeAll(() =>
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    })
);
describe('favorite provider references and projections', () => {
    it('checks requested Xtream identity before status or removal and allows explicit original removal', async () => {
        const saved = {
            id: null,
            category_id: null,
            xtream_id: 42,
            type: 'movie',
            title: 'Synthetic retained item',
            tmdb_id: 100,
            release_year: 1995,
        };
        const raw = {
            getFavorites: async () => [saved],
            getContentByXtreamId: async () => ({
                ...saved,
                id: 1,
                tmdb_id: 200,
                release_year: 2024,
            }),
        } as unknown as IXtreamDataSource;
        const set = jest.fn(async () => undefined);
        const client = {
            entries: async () => [],
            set,
        } as unknown as FavoritesSyncClient;
        const adapter = new FavoritesXtreamAdapter(client, () => true, false);
        const replacement = {
            id: 42,
            providerId: 42,
            type: 'movie',
            identity: { tmdbId: 200, releaseYear: 2024 },
        };
        expect(
            await adapter.invoke(raw, 'isFavorite', [replacement, 'source'])
        ).toBe(false);
        await expect(
            adapter.invoke(raw, 'removeFavorite', [replacement, 'source'])
        ).rejects.toThrow('XTREAM_FAVORITE_IDENTITY_CONFLICT');
        expect(set).not.toHaveBeenCalled();
        const original = {
            ...replacement,
            identity: { tmdbId: 100, releaseYear: 1995 },
        };
        expect(
            await adapter.invoke(raw, 'isFavorite', [original, 'source'])
        ).toBe(true);
        Object.assign(saved, { catalog_missing_reason: 'identity_conflict' });
        await adapter.invoke(raw, 'removeFavorite', [original, 'source']);
        expect(set).toHaveBeenCalledWith(
            'source',
            { provider: 'xtream', kind: 'movie', id: '42' },
            false,
            expect.objectContaining({ tmdbId: '100' })
        );
    });

    it('retains URL membership for duplicate M3U entries and verified legacy IDs', async () => {
        const source = playlist([]);
        expect((await playlistFavorite(source, 'one'))?.reference).toEqual(
            (await playlistFavorite(source, 'two'))?.reference
        );
        expect((await playlistFavorite(source, 'one'))?.reference).toEqual(
            (await playlistFavorite(source, 'https://fixture.invalid/one'))
                ?.reference
        );
        expect(await playlistFavorite(source, 'ambiguous')).toBeNull();
        expect(await playlistFavorite(source, 'unknown')).toBeNull();
    });
    it.each([
        [{ id: '42', category_id: 'series' }, 'regular'],
        [{ id: '42', category_id: 'vod', series: [1, 2] }, 'embedded'],
        [
            {
                id: '42',
                category_id: 7,
                favoriteContentType: 'vod',
                is_series: '1',
            },
            'lazy',
        ],
    ])('preserves Stalker series origin %j', async (item, mode) => {
        const local = await playlistFavorite(
            { ...playlist([]), macAddress: '00:11:22:33:44:55' },
            {
                ...item,
                cmd: 'synthetic-command',
                title: 'Synthetic series',
            } as StalkerPortalItem
        );
        expect(local?.reference).toMatchObject({
            provider: 'stalker',
            kind: 'series',
            mode,
        });
        const snapshot = JSON.stringify(local?.snapshot);
        expect(snapshot).not.toContain('synthetic-command');
        const projected = stalkerFavorite(
            local!.reference as Extract<
                FavoriteReference,
                { provider: 'stalker' }
            >,
            local!.snapshot
        );
        expect(
            (
                await playlistFavorite(
                    { ...playlist([]), macAddress: '00:11:22:33:44:55' },
                    projected
                )
            )?.reference
        ).toEqual(local?.reference);
    });
    it('does not infer an ambiguous Stalker content type from a title or command', async () => {
        expect(
            await playlistFavorite(
                { ...playlist([]), macAddress: '00:11:22:33:44:55' },
                { id: '42', title: 'Synthetic item', cmd: 'synthetic-command' }
            )
        ).toBeNull();
    });
    it('uses a server removal over a retained local favorite while keeping the original document', async () => {
        const source = playlist(['one']);
        const ref = (await playlistFavorite(source, 'one'))!.reference;
        const entry: FavoriteEntry = {
            address: {
                instanceId: 'nas',
                scope: 'shared',
                sourceId: 'source',
                sourceIncarnation: 'first',
                content: ref,
            },
            record: {
                base: { revision: 2, member: false },
                state: { revision: 2, member: false },
                pending: [],
            },
        };
        const client = {
            entries: async () => [entry],
        } as unknown as FavoritesSyncClient;
        const projected = await new FavoritesPlaylistAdapter(
            client,
            () => true
        ).project(source);
        expect(projected.favorites).toEqual([]);
        expect(source.favorites).toEqual(['one']);
    });
    it('does not promote an incompatible native catalog row or nullable SQLite optionals', async () => {
        const ref = {
            provider: 'xtream' as const,
            kind: 'movie' as const,
            id: '42',
        };
        const entry: FavoriteEntry = {
            address: {
                instanceId: 'nas',
                scope: 'shared',
                sourceId: 'source',
                sourceIncarnation: 'first',
                content: ref,
            },
            record: {
                base: { revision: 1, member: true },
                state: {
                    revision: 1,
                    member: true,
                    snapshot: { title: 'Synthetic saved item', tmdbId: '77' },
                },
                pending: [],
            },
        };
        const client = {
            entries: async () => [entry],
        } as unknown as FavoritesSyncClient;
        const raw = {
            getFavorites: async () => [],
            getContentByXtreamId: async () => ({
                id: 10,
                title: 'Synthetic replacement',
                category_id: 8,
                tmdb_id: 78,
                xtream_id: 42,
                type: 'movie',
                rating: '',
                added: '',
                poster_url: '',
            }),
        } as unknown as IXtreamDataSource;
        const projected = await new FavoritesXtreamAdapter(
            client,
            () => true,
            true
        ).project(raw, 'source');
        expect(projected[0]).toMatchObject({
            id: null,
            category_id: null,
            title: 'Synthetic saved item',
            catalog_missing_reason: 'identity_conflict',
        });
    });
});

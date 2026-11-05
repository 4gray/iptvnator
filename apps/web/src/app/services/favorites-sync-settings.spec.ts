import {
    previewLocalFavorites,
    importFavoritePreview,
    type FavoritesImportPreview,
} from './favorites-sync-settings';
import { projectFavoriteBackup } from './favorites-backup-projection';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type {
    Playlist,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { FavoriteEntry } from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
function fixture() {
    const source = {
        _id: 'source',
        serverUrl: 'https://fixture.invalid',
        title: 'Synthetic source',
    } as Playlist;
    const entries: FavoriteEntry[] = [42, 43].map((id) => ({
        address: {
            instanceId: 'nas',
            scope: 'shared',
            sourceId: 'source',
            sourceIncarnation: 'first',
            content: { provider: 'xtream', kind: 'movie', id: String(id) },
        },
        record: {
            base: { revision: 1, member: false },
            state: { revision: 1, member: false },
            local: {
                revision: 1,
                member: id === 43,
                snapshot: { title: 'Synthetic retained item' },
            },
            pending: [],
        },
    }));
    const set = jest.fn(async () => undefined);
    const client = {
        options: {
            instanceId: 'nas',
            consent: () => 'consent',
            profileActive: () => true,
        },
        context: async () => ({
            sourceId: 'source',
            sourceIncarnation: 'first',
            provider: 'xtream',
        }),
        entries: async () => entries,
        set,
    } as unknown as FavoritesSyncClient;
    const raw = {
        getFavorites: async () => [
            {
                id: null,
                category_id: null,
                xtream_id: 42,
                type: 'movie',
                title: 'Synthetic archive',
                rating: '',
                added: '',
                poster_url: '',
                tmdb_id: null,
                release_year: null,
            },
        ],
    } as unknown as IXtreamDataSource;
    return { source, entries, client, raw, set };
}
describe('favorite preview and retained local copy', () => {
    it('includes disabled local additions and excludes disabled removals, without an upload', async () => {
        const f = fixture();
        const preview = await previewLocalFavorites(
            f.client,
            f.raw,
            {} as FavoritesPlaylistAdapter,
            [f.source],
            async () => f.source,
            'consent'
        );
        expect(preview.sources[0].items.map((item) => item.reference)).toEqual([
            { provider: 'xtream', kind: 'movie', id: '43' },
        ]);
        expect(f.set).not.toHaveBeenCalled();
        expect(preview.unresolved).toBe(0);
    });
    it('rejects a preview from another consent and keeps retired-incarnation items unresolved', async () => {
        const f = fixture();
        const preview: FavoritesImportPreview = {
            instanceId: 'nas',
            generation: 'old',
            sources: [
                {
                    sourceId: 'source',
                    incarnation: 'first',
                    items: [
                        {
                            reference: {
                                provider: 'xtream',
                                kind: 'movie',
                                id: '43',
                            },
                            snapshot: {},
                            original: '',
                        },
                    ],
                },
            ],
            unresolved: 0,
        };
        await expect(importFavoritePreview(f.client, preview)).rejects.toThrow(
            'expired'
        );
        expect(
            await importFavoritePreview(f.client, {
                ...preview,
                generation: 'consent',
                sources: [{ ...preview.sources[0], incarnation: 'retired' }],
            })
        ).toBe(1);
        expect(f.set).not.toHaveBeenCalled();
    });
    it.each([false, true])(
        'overlays shared identity on an archived Xtream backup (explicitConflict=%s)',
        async (explicitConflict) => {
            const f = fixture();
            f.entries[0].record.state = {
                revision: 2,
                member: true,
                snapshot: {
                    title: 'Synthetic shared item',
                    tmdbId: '100',
                    releaseYear: '1995',
                    ...(explicitConflict ? { identityConflict: true } : {}),
                },
            };
            const entry = {
                portalType: 'xtream',
                exportedId: 'source',
                title: 'Synthetic source',
                autoRefresh: false,
                connection: {
                    serverUrl: 'https://fixture.invalid',
                    username: 'fixture',
                    password: 'fixture',
                },
                userState: {
                    hiddenCategories: [],
                    favorites: [
                        {
                            xtreamId: 42,
                            contentType: 'movie',
                            position: 3,
                            addedAt: '2026-01-01T00:00:00Z',
                            snapshot: {
                                title: 'Synthetic archived item',
                                tmdbId: 200,
                                releaseYear: 2024,
                                catalogStatus: 'present',
                            },
                        },
                    ],
                    recentlyViewed: [],
                    playbackPositions: [],
                },
            } as XtreamPlaylistBackupEntry;
            const result = (await projectFavoriteBackup(
                f.client,
                {} as FavoritesPlaylistAdapter,
                f.source,
                entry
            )) as XtreamPlaylistBackupEntry;
            expect(result.userState.favorites[0]).toMatchObject({
                xtreamId: 42,
                position: 3,
                addedAt: '2026-01-01T00:00:00Z',
                snapshot: {
                    tmdbId: 100,
                    releaseYear: 1995,
                    catalogStatus: 'missing',
                    catalogMissingReason: 'identity_conflict',
                },
            });
            expect(entry.userState.favorites[0].snapshot?.tmdbId).toBe(200);
            expect(f.set).not.toHaveBeenCalled();
        }
    );

    it('exports the durable visible projection without importing or changing recent history', async () => {
        const f = fixture();
        f.entries[1].record.state = {
            revision: 2,
            member: true,
            snapshot: { title: 'Synthetic shared item' },
        };
        const entry = {
            portalType: 'xtream',
            exportedId: 'source',
            title: 'Synthetic source',
            autoRefresh: false,
            connection: {
                serverUrl: 'https://fixture.invalid',
                username: 'synthetic-user',
                password: 'synthetic-secret',
            },
            userState: {
                hiddenCategories: [],
                favorites: [{ xtreamId: 42, contentType: 'movie' }],
                recentlyViewed: [],
                playbackPositions: [],
            },
        } as XtreamPlaylistBackupEntry;
        const result = (await projectFavoriteBackup(
            f.client,
            {} as FavoritesPlaylistAdapter,
            f.source,
            entry
        )) as XtreamPlaylistBackupEntry;
        expect(result.userState.favorites).toEqual([
            {
                xtreamId: 43,
                contentType: 'movie',
                snapshot: {
                    title: 'Synthetic shared item',
                    catalogStatus: 'unknown',
                },
            },
        ]);
        expect(result.userState.recentlyViewed).toEqual(
            entry.userState.recentlyViewed
        );
        expect(f.set).not.toHaveBeenCalled();
        expect(entry.userState.favorites).toHaveLength(1);
    });
});

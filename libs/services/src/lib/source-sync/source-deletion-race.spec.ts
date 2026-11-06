import { firstValueFrom } from 'rxjs';
import type { Playlist, SourceDefinition } from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { PlaylistsService } from '../playlists.service';
import { SourceCleanupQueue } from './source-cleanup-queue';
import { SyncedPlaylistStore } from './synced-playlist-store';

describe('single-source deletion without Web Locks', () => {
    const source: SourceDefinition = {
        id: 'deleted-source',
        title: 'Original',
        kind: 'm3u-text',
        rawM3u: '#EXTM3U',
    };
    const prefix = 'test:single-source-cleanup:';
    const locks = navigator.locks;

    beforeEach(() => {
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: undefined,
        });
    });
    afterEach(() => {
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: locks,
        });
        localStorage.removeItem(`${prefix}${source.id}`);
    });

    it.each([false, true])(
        'scopes row removal and downstream cleanup to the deleted revision (replacement: %s)',
        async (replace) => {
            const rows = new Map<string, Playlist>([
                [
                    source.id,
                    {
                        ...applySourceDefinition(source),
                        sourceSyncBase: source,
                        sourceSyncRevision: '"1"',
                    },
                ],
            ]);
            const local: PlaylistDocumentStore = {
                dbGetAppPlaylist: async (id) =>
                    structuredClone(rows.get(id) ?? null),
                dbGetAppPlaylists: async () => [...rows.values()],
                dbMutateAppPlaylist: async (id, mutate) => {
                    const next = mutate(structuredClone(rows.get(id) ?? null));
                    rows.set(id, structuredClone(next));
                    return next;
                },
                dbPruneAppPlaylist: async (id, revision, beforeDelete) => {
                    if (rows.get(id)?.sourceSyncRevision !== revision)
                        return false;
                    beforeDelete();
                    return rows.delete(id);
                },
                dbDeletePlaylist: async (id) => {
                    rows.delete(id);
                    return { success: true };
                },
                dbDeleteAllPlaylists: jest.fn(),
                dbUpsertAppPlaylist: jest.fn(),
                dbUpsertAppPlaylists: jest.fn(),
                dbGetAppState: jest.fn(),
                dbSetAppState: jest.fn(),
            };
            const cleanup = jest.fn().mockResolvedValue(undefined);
            const queue = new SourceCleanupQueue(local, [cleanup], prefix);
            local.dbDeletePlaylist = queue.remove;
            let accepted!: () => void;
            const started = new Promise<void>(
                (resolve) => (accepted = resolve)
            );
            let release!: () => void;
            const response = new Promise<void>(
                (resolve) => (release = resolve)
            );
            const request = jest.fn(async () => {
                accepted();
                await response;
                return { status: 204 };
            });
            const store = new SyncedPlaylistStore(
                local,
                request,
                async (value, current) => applySourceDefinition(value, current),
                'test',
                queue.prune
            );
            store.pendingSources.add(source.id);
            const service = Object.create(
                PlaylistsService.prototype
            ) as PlaylistsService;
            Object.assign(service, {
                storageBackend: {
                    kind: () => 'server',
                    documentStore: () => store,
                },
                ensureElectronPlaylistMigrations: jest
                    .fn()
                    .mockResolvedValue(undefined),
                playlistWriteQueues: new Map(),
                resets: 0,
                playlistDeleteCleanups: [cleanup],
            });
            const deleting = firstValueFrom(service.deletePlaylist(source.id));
            await started;
            let replacement: Playlist | undefined;
            if (replace) {
                const sibling = new SyncedPlaylistStore(
                    local,
                    request,
                    async (value, current) =>
                        applySourceDefinition(value, current)
                );
                rows.delete(source.id);
                await sibling.project(
                    { ...source, title: 'Replacement' },
                    '"3"'
                );
                rows.get(source.id)!.favorites = ['sibling-favorite'];
                rows.get(source.id)!.recentlyViewed = [
                    {
                        source: 'm3u',
                        id: 'sibling-recent',
                        url: 'https://media.test/recent',
                        title: 'Viewed in sibling',
                        category_id: 'live',
                        added_at: 1,
                    },
                ];
                replacement = structuredClone(rows.get(source.id));
            }
            release();
            await expect(deleting).resolves.toEqual({ success: true });
            expect(request).toHaveBeenCalledWith({
                operation: 'delete',
                id: source.id,
                revision: '"1"',
            });
            expect(rows.get(source.id)).toEqual(replacement);
            expect(cleanup).toHaveBeenCalledTimes(replace ? 0 : 1);
            expect(localStorage.getItem(`${prefix}${source.id}`)).toBeNull();
            expect(store.pendingSources.has(source.id)).toBe(replace);
        }
    );
});

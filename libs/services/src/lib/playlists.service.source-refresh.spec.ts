import { firstValueFrom } from 'rxjs';
import type {
    Playlist,
    SourceDefinition,
    SourceServerRequest,
} from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import { PlaylistsService } from './playlists.service';
import type { PlaylistDocumentStore } from './playlist-storage-backend';
import type { DataService } from './data.service';
import { materializeSource } from './source-sync/source-materializer';
import { SyncedPlaylistStore } from './source-sync/synced-playlist-store';

const before: SourceDefinition = {
    id: 'shared',
    title: 'Original name',
    kind: 'm3u-url',
    url: 'https://old.test/list.m3u',
    userAgent: 'Original agent',
};
const payload = (name: string) => ({
    items: [{ id: name, name, url: `https://media.test/${name}` }],
});

describe('shared M3U refresh authority', () => {
    it.each([
        ['single', { url: 'https://new.test/list.m3u' }, true],
        ['batch', { url: 'https://new.test/list.m3u' }, true],
        ['single', { userAgent: 'New agent' }, true],
        ['batch', { userAgent: 'New agent' }, true],
        ['single', { title: 'Renamed remotely' }, false],
        ['batch', { title: 'Renamed remotely' }, false],
    ] as const)(
        'keeps the accepted definition after a delayed %s refresh (%j)',
        async (mode, edit, stale) => {
            let row: Playlist = {
                ...applySourceDefinition(before),
                sourceSyncBase: before,
                sourceSyncRevision: '"1"',
                playlist: payload('Original'),
                count: 1,
                favorites: ['private'],
            };
            const local = {
                dbGetAppPlaylist: async () => structuredClone(row),
                dbGetAppState: async () => '1',
                dbUpsertAppPlaylist: async (next: Playlist) => {
                    row = structuredClone(next);
                    return { success: true };
                },
            } as unknown as PlaylistDocumentStore;
            const request = jest.fn(async (command: SourceServerRequest) => ({
                status: 200,
                etag: '"3"',
                body: command.source!,
            }));
            const store = new SyncedPlaylistStore(
                local,
                request,
                (source, current) =>
                    materializeSource(source, current, {
                        fetchPlaylistDefinition: async () => ({
                            playlist: payload('Accepted'),
                            count: 1,
                        }),
                    } as unknown as DataService)
            );
            const service = Object.create(
                PlaylistsService.prototype
            ) as PlaylistsService;
            Object.assign(service, {
                storageBackend: {
                    kind: () => 'server',
                    documentStore: () => store,
                },
                playlistWriteQueues: new Map(),
                deletingAll: Promise.resolve(),
                resets: 0,
                electronMigrationPromise: null,
                indexedDbMigrationPromise: null,
                startupMetas: null,
            });
            const downloaded = {
                ...applySourceDefinition(before),
                playlist: payload('Delayed'),
                count: 1,
            };
            const accepted = { ...before, ...edit };
            await store.project(accepted, '"2"');
            const acceptedChannels = structuredClone(row.playlist);
            if (mode === 'single')
                await firstValueFrom(
                    service.updatePlaylist(before.id, downloaded)
                );
            else
                await firstValueFrom(service.updateManyPlaylists([downloaded]));
            expect(request).not.toHaveBeenCalled();
            expect(row).toMatchObject({
                url: accepted.url,
                userAgent: accepted.userAgent,
                title: accepted.title,
                sourceSyncBase: accepted,
                sourceSyncRevision: '"2"',
                favorites: ['private'],
            });
            expect(row.playlist).toEqual(
                stale ? acceptedChannels : downloaded.playlist
            );
        }
    );
});

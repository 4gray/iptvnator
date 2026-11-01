import { of } from 'rxjs';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

describe('M3U backup EPG import preference', () => {
    it('round-trips an opt-out without automatically enabling detected links', async () => {
        const guide = 'https://provider.test/epg.xml';
        const playlist: Playlist = {
            _id: 'm3u',
            title: 'M3U',
            count: 1,
            autoRefresh: false,
            importDate: '',
            lastUsage: '',
            favorites: [],
            autoImportEpg: false,
            detectedEpgUrls: [guide],
            epgUrls: [],
        };
        const raw = `#EXTM3U x-tvg-url="${guide}"\n#EXTINF:-1,Channel\nhttps://media.test/live`;
        const exported = await createPlaylistBackupService({
            playlistsService: {
                getAllData: () => of([playlist]),
                getRawPlaylistById: () => of(raw),
            },
        }).exportBackup();
        expect(exported.manifest.playlists[0]).toMatchObject({
            autoImportEpg: false,
        });

        const restorePlaylist = jest.fn((value: Playlist) => of(value));
        const service = createPlaylistBackupService({
            playlistsService: {
                getAllData: () => of([]),
                restorePlaylist,
                handlePlaylistParsing: async () => ({
                    ...playlist,
                    autoImportEpg: undefined,
                    epgUrls: [guide],
                    detectedEpgUrls: [guide],
                }),
            },
        });
        const summary = await service.importBackup(
            JSON.stringify(exported.manifest)
        );
        expect(summary.failed).toBe(0);
        expect(summary.imported).toBe(1);
        expect(restorePlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                autoImportEpg: false,
                detectedEpgUrls: [guide],
                epgUrls: [],
            })
        );
    });
});

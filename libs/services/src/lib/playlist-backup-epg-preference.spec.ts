import { of } from 'rxjs';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

describe('M3U backup EPG import preference', () => {
    it.each([true, undefined])(
        'restores exported default-on preference %s over a matching opt-out',
        async (preference) => {
            const guide = 'https://guide.example.test/default.xml';
            const source = {
                _id: 'synthetic-default-on',
                title: 'Synthetic default-on playlist',
                url: 'https://provider.example.test/default.m3u',
                count: 1,
                importDate: '',
                lastUsage: '',
                autoRefresh: false,
                favorites: [],
                autoImportEpg: preference,
                detectedEpgUrls: [guide],
                epgUrls: [guide],
            } as Playlist;
            const exported = await createPlaylistBackupService({
                playlistsService: {
                    getAllData: () => of([source]),
                    getRawPlaylistById: () =>
                        of(`#EXTM3U x-tvg-url="${guide}"`),
                },
            }).exportBackup();
            expect(exported.manifest.playlists[0]).toMatchObject({
                autoImportEpg: true,
            });
            const restorePlaylist = jest.fn((value: Playlist) => of(value));
            const summary = await createPlaylistBackupService({
                playlistsService: {
                    getAllData: () =>
                        of([{ ...source, autoImportEpg: false, epgUrls: [] }]),
                    handlePlaylistParsing: async () => source,
                    restorePlaylist,
                },
            }).importBackup(JSON.stringify(exported.manifest));
            expect(summary.failed).toBe(0);
            expect(summary.merged).toBe(1);
            expect(restorePlaylist).toHaveBeenCalledWith(
                expect.objectContaining({
                    autoImportEpg: true,
                    epgUrls: [guide],
                })
            );
        }
    );

    it.each([undefined, false, true])(
        'retains explicit local EPG selections when restoring a backup with preference %s',
        async (backupPreference) => {
            const manual = 'https://manual.example.test/guide.xml';
            const disabled = 'https://provider.example.test/disabled.xml';
            const detected = 'https://provider.example.test/new.xml';
            const existing = {
                _id: 'existing',
                title: 'Synthetic playlist',
                count: 0,
                autoRefresh: false,
                importDate: '',
                lastUsage: '',
                favorites: [],
                url: 'https://provider.example.test/list.m3u',
                autoImportEpg: false,
                manualEpgUrls: [manual],
                disabledEpgUrls: [disabled],
                epgUrls: [manual],
            } as Playlist;
            const restorePlaylist = jest.fn((value: Playlist) => of(value));
            const service = createPlaylistBackupService({
                playlistsService: {
                    getAllData: () => of([existing]),
                    restorePlaylist,
                    handlePlaylistParsing: async () => ({
                        ...existing,
                        autoImportEpg: undefined,
                        manualEpgUrls: [],
                        disabledEpgUrls: [],
                        detectedEpgUrls: [detected, disabled],
                        epgUrls: [detected, disabled],
                    }),
                },
            });
            const summary = await service.importBackup(
                JSON.stringify({
                    kind: 'iptvnator-playlist-backup',
                    version: 1,
                    exportedAt: '2026-11-01T00:00:00.000Z',
                    includeSecrets: true,
                    settings: { epgUrls: [] },
                    playlists: [
                        {
                            portalType: 'm3u',
                            exportedId: 'backup',
                            title: 'Synthetic restored playlist',
                            autoRefresh: false,
                            autoImportEpg: backupPreference,
                            source: {
                                kind: 'url',
                                url: existing.url,
                                rawM3u: '#EXTM3U',
                            },
                            userState: {
                                favorites: [],
                                recentlyViewed: [],
                                hiddenGroupTitles: [],
                            },
                        },
                    ],
                })
            );
            expect(summary.failed).toBe(0);
            expect(summary.merged).toBe(1);
            expect(restorePlaylist).toHaveBeenCalledWith(
                expect.objectContaining({
                    autoImportEpg: backupPreference ?? false,
                    manualEpgUrls: [manual],
                    disabledEpgUrls: [disabled],
                    detectedEpgUrls: [detected, disabled],
                    epgUrls:
                        backupPreference === true
                            ? [detected, manual]
                            : [manual],
                })
            );
        }
    );

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

import { of } from 'rxjs';
import { PlaylistBackupManifestV1 } from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

const m3u = {
    portalType: 'm3u',
    exportedId: 'm3u',
    title: 'Test M3U',
    autoRefresh: false,
    source: {
        kind: 'text',
        rawM3u: '#EXTM3U\n#EXTINF:-1,Test\nhttps://example.test/live',
    },
    userState: { favorites: [], recentlyViewed: [], hiddenGroupTitles: [] },
};
const stalker = {
    portalType: 'stalker',
    exportedId: 'stalker',
    title: 'Test Stalker',
    autoRefresh: false,
    connection: {
        portalUrl: 'https://example.test/portal',
        macAddress: '00:1A:79:00:00:01',
    },
    userState: { favorites: [], recentlyViewed: [] },
};

describe('Backup validation before writes', () => {
    it('keeps exact hidden M3U group titles through import and export', async () => {
        let saved: unknown[] = [];
        const service = createPlaylistBackupService({
            playlistsService: {
                getAllData: () => of(saved),
                restorePlaylist: (playlist: unknown) => {
                    saved = [playlist];
                    return of(playlist);
                },
                handlePlaylistParsing: () => ({}),
                getRawPlaylistById: () => of(m3u.source.rawM3u),
            },
        });
        const manifest = {
            kind: 'iptvnator-playlist-backup',
            version: 1,
            playlists: [
                {
                    ...m3u,
                    userState: {
                        ...m3u.userState,
                        hiddenGroupTitles: [' News '],
                    },
                },
            ],
        };
        await service.importBackup(JSON.stringify(manifest));
        const backup = await service.exportBackup();
        expect(backup.manifest.playlists[0].userState).toEqual(
            expect.objectContaining({ hiddenGroupTitles: [' News '] })
        );
    });

    it.each([
        [
            'missing M3U favorites',
            {
                ...m3u,
                userState: { recentlyViewed: [], hiddenGroupTitles: [] },
            },
        ],
        [
            'string M3U favorites',
            { ...m3u, userState: { ...m3u.userState, favorites: 'abc' } },
        ],
        [
            'missing Stalker history',
            { ...stalker, userState: { favorites: [] } },
        ],
        [
            'non-string source URL',
            { ...m3u, source: { ...m3u.source, url: 42 } },
        ],
        [
            'damaged M3U payload',
            { ...m3u, source: { ...m3u.source, rawM3u: 'broken data' } },
        ],
        ['invalid playlist position', { ...m3u, position: 'first' }],
        ['non-string title', { ...m3u, title: 42 }],
    ])(
        'rejects %s before changing settings or an earlier valid entry',
        async (_label, damaged) => {
            const restorePlaylist = jest.fn((playlist) => of(playlist));
            const updateSettings = jest.fn();
            const service = createPlaylistBackupService({
                playlistsService: {
                    getAllData: () => of([]),
                    restorePlaylist,
                    handlePlaylistParsing: jest.fn(() => ({})),
                },
                settingsStore: {
                    getSettings: () => ({ epgUrl: [] }),
                    updateSettings,
                },
            });
            const manifest = {
                kind: 'iptvnator-playlist-backup',
                version: 1,
                exportedAt: '2026-10-27T00:00:00Z',
                includeSecrets: true,
                settings: { epgUrls: ['https://example.test/epg.xml'] },
                playlists: [
                    {
                        ...m3u,
                        exportedId: 'first',
                        source: {
                            ...m3u.source,
                            url: 'https://first.test/list.m3u',
                        },
                    },
                    damaged,
                ],
            } as unknown as PlaylistBackupManifestV1;

            await expect(
                service.importBackup(JSON.stringify(manifest))
            ).rejects.toThrow();
            expect(restorePlaylist).not.toHaveBeenCalled();
            expect(updateSettings).not.toHaveBeenCalled();
        }
    );
});

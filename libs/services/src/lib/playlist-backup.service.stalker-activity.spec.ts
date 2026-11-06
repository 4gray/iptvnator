import { of } from 'rxjs';
import type {
    PlaybackPositionData,
    Playlist,
    StalkerPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import { XTREAM_USER_DATA_KEYS } from './user-data-storage';

const playlist = {
    _id: 'synthetic-stalker',
    title: 'Synthetic source',
    portalUrl: 'http://synthetic.invalid/portal',
    macAddress: '00:00:00:00:00:00',
} as Playlist;
const local: PlaybackPositionData = {
    contentType: 'vod',
    contentXtreamId: 42,
    positionSeconds: 10,
    durationSeconds: 100,
};
const projected: PlaybackPositionData[] = [
    { ...local, positionSeconds: 65 },
    {
        contentType: 'episode',
        contentXtreamId: 1001,
        seriesXtreamId: 100,
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 100,
        durationSeconds: 100,
        watched: true,
    },
    {
        contentType: 'episode',
        contentXtreamId: 1002,
        seriesXtreamId: 100,
        seasonNumber: 1,
        episodeNumber: 2,
        positionSeconds: 0,
        durationSeconds: 0,
        watched: false,
    },
];

describe.each([false, true])(
    'Stalker activity backup (native: %s)',
    (native) => {
        afterEach(() => localStorage.clear());
        function setup(source = playlist) {
            const rows = new Map([[source._id, [local]]]);
            const replace = jest.fn(
                async (id: string, positions: PlaybackPositionData[]) => {
                    rows.set(id, positions);
                }
            );
            const restorePlaylist = jest.fn((value: Playlist) => of(value));
            localStorage.setItem(
                XTREAM_USER_DATA_KEYS.playbackPositions,
                JSON.stringify({
                    ...JSON.parse(
                        localStorage.getItem(
                            XTREAM_USER_DATA_KEYS.playbackPositions
                        ) ?? '{}'
                    ),
                    [source._id]: [local],
                })
            );
            const service = createPlaylistBackupService({
                runtime: { supportsXtreamSqliteDataSource: native },
                playlistsService: {
                    getAllData: () => of([source]),
                    restorePlaylist,
                },
                playbackPositionService: {
                    assertSupportsAtomicReplacement: jest.fn(),
                    getAllPlaybackPositionsOrThrow: async (id: string) =>
                        rows.get(id) ?? [],
                    replaceAllPlaybackPositions: replace,
                },
            });
            return { service, replace, restorePlaylist, rows };
        }
        it('exports shared progress, watched marks and reset barriers and restores them only locally under the matched source', async () => {
            const h = setup();
            const projector = jest.fn(async () => projected);
            const backup = await h.service.exportBackup(projector);
            const entry = backup.manifest
                .playlists[0] as StalkerPlaylistBackupEntry;
            expect(projector).toHaveBeenCalledWith(playlist._id, [local]);
            expect(entry.userState.playbackPositions).toEqual(projected);
            const target = 'synthetic-restored';
            const restored = setup({ ...playlist, _id: target });
            expect(
                await restored.service.importBackup(backup.json)
            ).toMatchObject({ merged: 1, failed: 0 });
            const positions = native
                ? restored.rows.get(target)
                : JSON.parse(
                      localStorage.getItem(
                          XTREAM_USER_DATA_KEYS.playbackPositions
                      )!
                  )[target];
            expect(positions).toEqual(
                projected.map((position) => ({
                    ...position,
                    playlistId: target,
                }))
            );
            if (!native)
                expect(
                    JSON.parse(
                        localStorage.getItem(
                            XTREAM_USER_DATA_KEYS.playbackPositions
                        )!
                    )[playlist._id]
                ).toEqual([local]);
        });
        it('keeps positions when a historical archive omits them', async () => {
            const h = setup();
            const backup = await h.service.exportBackup();
            delete (backup.manifest.playlists[0] as StalkerPlaylistBackupEntry)
                .userState.playbackPositions;
            expect(
                await h.service.importBackup(JSON.stringify(backup.manifest))
            ).toMatchObject({ failed: 0 });
            expect(h.replace).not.toHaveBeenCalled();
            const positions = native
                ? h.rows.get(playlist._id)
                : JSON.parse(
                      localStorage.getItem(
                          XTREAM_USER_DATA_KEYS.playbackPositions
                      )!
                  )[playlist._id];
            expect(positions).toEqual([local]);
        });
        it('treats an explicit empty position collection as a local clear', async () => {
            const h = setup();
            const backup = await h.service.exportBackup(async () => []);
            expect(await h.service.importBackup(backup.json)).toMatchObject({
                failed: 0,
            });
            const positions = native
                ? h.rows.get(playlist._id)
                : JSON.parse(
                      localStorage.getItem(
                          XTREAM_USER_DATA_KEYS.playbackPositions
                      )!
                  )[playlist._id];
            expect(positions).toEqual([]);
        });
        it.each([
            {},
            { ...local, watched: 'true' },
            { ...local, durationSeconds: null },
        ])(
            'rejects malformed positions before changing playlist metadata (%o)',
            async (invalid) => {
                const h = setup();
                const backup = await h.service.exportBackup();
                (
                    backup.manifest.playlists[0] as StalkerPlaylistBackupEntry
                ).userState.playbackPositions = [
                    invalid as PlaybackPositionData,
                ];
                await expect(
                    h.service.importBackup(JSON.stringify(backup.manifest))
                ).rejects.toThrow();
                expect(h.restorePlaylist).not.toHaveBeenCalled();
            }
        );
        it('fails export when the shared projection fails', async () => {
            await expect(
                setup().service.exportBackup(async () => {
                    throw new Error('Synthetic projection failure');
                })
            ).rejects.toThrow('Synthetic projection failure');
        });
    }
);

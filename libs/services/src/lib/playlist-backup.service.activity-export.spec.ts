import { of } from 'rxjs';
import type {
    PlaybackPositionData,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import { existingXtreamPlaylist } from './playlist-backup.xtream-fixtures';
import { XTREAM_USER_DATA_KEYS } from './user-data-storage';

const legacy: PlaybackPositionData = {
    contentType: 'vod',
    contentXtreamId: 1,
    positionSeconds: 10,
};
const projected: PlaybackPositionData = {
    contentType: 'vod',
    contentXtreamId: 2,
    positionSeconds: 100,
    durationSeconds: 100,
    watched: true,
};

describe.each([false, true])('activity-aware backup (SQLite: %s)', (native) => {
    afterEach(() => localStorage.clear());
    function setup(pending = false) {
        localStorage.setItem(
            XTREAM_USER_DATA_KEYS.playbackPositions,
            JSON.stringify({ [existingXtreamPlaylist._id]: [legacy] })
        );
        return createPlaylistBackupService({
            runtime: { supportsXtreamSqliteDataSource: native },
            playlistsService: {
                getAllData: () => of([existingXtreamPlaylist]),
            },
            playbackPositionService: {
                getAllPlaybackPositionsOrThrow: async () => [legacy],
            },
            ...(pending
                ? {
                      pendingRestoreService: {
                          getOrThrow: () => ({
                              hiddenCategories: [],
                              favorites: [],
                              recentlyViewed: [],
                              playbackPositions: [legacy],
                          }),
                      },
                  }
                : {}),
        });
    }
    it('exports the current projection instead of stale legacy positions', async () => {
        const projector = jest.fn(
            async (_id: string, _local: PlaybackPositionData[]) => [projected]
        );
        const result = await setup().exportBackup(projector);
        expect(projector).toHaveBeenCalledWith(existingXtreamPlaylist._id, [
            legacy,
        ]);
        expect(
            (result.manifest.playlists[0] as XtreamPlaylistBackupEntry)
                .userState.playbackPositions
        ).toEqual([projected]);
        expect(
            JSON.parse(result.json).playlists[0].userState.playbackPositions
        ).toEqual([projected]);
    });
    it('keeps a pending restore authoritative without reading shared activity', async () => {
        const projector = jest.fn(async () => [projected]);
        const result = await setup(true).exportBackup(projector);
        expect(projector).not.toHaveBeenCalled();
        expect(
            (result.manifest.playlists[0] as XtreamPlaylistBackupEntry)
                .userState.playbackPositions
        ).toEqual([legacy]);
    });
    it('fails export if the shared projection cannot be read', async () => {
        await expect(
            setup().exportBackup(async () => {
                throw new Error('activity unreadable');
            })
        ).rejects.toThrow('activity unreadable');
    });
});

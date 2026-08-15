import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { XTREAM_DATA_SOURCE } from '../../data-sources/xtream-data-source.interface';
import { withPlaybackPositions } from './with-playback-positions.feature';

function position(
    contentXtreamId: number,
    playlistId: string
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: 7,
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 50,
        durationSeconds: 100,
        playlistId,
    };
}

describe('withPlaybackPositions', () => {
    const TestStore = signalStore(
        { providedIn: 'root' },
        withPlaybackPositions()
    );
    const getAllPlaybackPositions = jest.fn();

    function createStore() {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: { getAllPlaybackPositions },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: jest
                            .fn()
                            .mockReturnValue(jest.fn()),
                    },
                },
            ],
        });
        return TestBed.inject(TestStore);
    }

    beforeEach(() => {
        getAllPlaybackPositions.mockReset();
    });

    it('loads positions into the store maps', async () => {
        getAllPlaybackPositions.mockResolvedValue([position(11, 'playlist-a')]);
        const store = createStore();

        await store.loadAllPositions('playlist-a');

        expect(store.playbackPositions().get('episode_11')).toBeDefined();
        expect(store.hasSeriesProgress(7)).toBe(true);
    });

    it('keeps the cached maps when a refresh read fails', async () => {
        getAllPlaybackPositions.mockResolvedValueOnce([
            position(11, 'playlist-a'),
        ]);
        const store = createStore();
        await store.loadAllPositions('playlist-a');

        getAllPlaybackPositions.mockRejectedValueOnce(new Error('ipc down'));
        await expect(store.loadAllPositions('playlist-a')).rejects.toThrow(
            'ipc down'
        );

        expect(store.playbackPositions().get('episode_11')).toBeDefined();
        expect(store.hasSeriesProgress(7)).toBe(true);
    });

    it('discards a superseded load so a late result cannot overwrite the newer playlist', async () => {
        let resolveFirst!: (rows: PlaybackPositionData[]) => void;
        getAllPlaybackPositions
            .mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData[]>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce([position(22, 'playlist-b')]);
        const store = createStore();

        const stale = store.loadAllPositions('playlist-a');
        await store.loadAllPositions('playlist-b');

        resolveFirst([position(11, 'playlist-a')]);
        await stale;

        expect(store.playbackPositions().has('episode_11')).toBe(false);
        expect(store.playbackPositions().get('episode_22')).toBeDefined();
    });
});

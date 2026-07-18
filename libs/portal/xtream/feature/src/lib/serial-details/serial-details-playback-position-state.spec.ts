import type {
    ExternalPlayerSession,
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

function episode(id: string, season: number, episodeNum: number) {
    return {
        id,
        season,
        episode_num: episodeNum,
        title: `Episode ${episodeNum}`,
    };
}

function seriesView(): XtreamSerieDetailsView {
    return {
        series_id: 103,
        info: {},
        episodes: {
            '1': [episode('1001', 1, 1), episode('1002', 1, 2)],
            '2': [episode('2001', 2, 1)],
        },
    } as unknown as XtreamSerieDetailsView;
}

function position(
    contentXtreamId: number,
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: 103,
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 60,
        durationSeconds: 1200,
        playlistId: 'xtream-1',
        updatedAt: '2026-05-10T12:00:00.000Z',
        ...overrides,
    } as PlaybackPositionData;
}

function playback(
    contentXtreamId: number,
    overrides: Partial<ResolvedPortalPlayback> = {}
): ResolvedPortalPlayback {
    return {
        streamUrl: `http://xtream.example/series/${contentXtreamId}.mp4`,
        title: 'Episode',
        contentInfo: {
            playlistId: 'xtream-1',
            contentXtreamId,
            contentType: 'episode',
            seriesXtreamId: 103,
            seasonNumber: 2,
            episodeNumber: 1,
        },
        ...overrides,
    } as ResolvedPortalPlayback;
}

const session = {
    id: 'vlc-1',
    player: 'vlc',
    status: 'opened',
} as ExternalPlayerSession;

const target = {
    seriesXtreamId: 103,
    contentXtreamId: 2001,
    seasonNumber: 2,
    episodeNumber: 1,
};

describe('SerialDetailsPlaybackPositionState', () => {
    let state: SerialDetailsPlaybackPositionState;

    beforeEach(() => {
        state = new SerialDetailsPlaybackPositionState();
    });

    async function loadPositions(
        positions: PlaybackPositionData[] = [position(2001)]
    ): Promise<void> {
        await state.load('xtream-1', 103, () => Promise.resolve(positions));
    }

    describe('load', () => {
        it('keeps only the latest concurrent load result', async () => {
            let resolveFirst!: (value: PlaybackPositionData[]) => void;
            const first = state.load(
                'xtream-1',
                103,
                () =>
                    new Promise<PlaybackPositionData[]>((resolve) => {
                        resolveFirst = resolve;
                    })
            );
            await loadPositions([position(2001, { positionSeconds: 84 })]);

            resolveFirst([position(1001, { positionSeconds: 5 })]);
            await first;

            expect(state.positions().get(2001)?.positionSeconds).toBe(84);
            expect(state.positions().has(1001)).toBe(false);
        });
    });

    describe('takeResumeEpisode', () => {
        it('rejects targets before positions finish loading', () => {
            expect(
                state.takeResumeEpisode({
                    playlistId: 'xtream-1',
                    selectedItem: seriesView(),
                    target,
                })
            ).toBeNull();
        });

        it('rejects targets that belong to another series', async () => {
            await loadPositions();

            expect(
                state.takeResumeEpisode({
                    playlistId: 'xtream-1',
                    selectedItem: seriesView(),
                    target: { ...target, seriesXtreamId: 999 },
                })
            ).toBeNull();
        });

        it('consumes a matching target only once', async () => {
            await loadPositions();
            const request = {
                playlistId: 'xtream-1',
                selectedItem: seriesView(),
                target,
            };

            expect(state.takeResumeEpisode(request)?.id).toBe('2001');
            expect(state.takeResumeEpisode(request)).toBeNull();
        });

        it('falls back to season/episode matching for unknown episode ids', async () => {
            await loadPositions();

            expect(
                state.takeResumeEpisode({
                    playlistId: 'xtream-1',
                    selectedItem: seriesView(),
                    target: { ...target, contentXtreamId: 5555 },
                })?.id
            ).toBe('2001');
        });

        it('leaves unmatched targets unconsumed until episodes arrive', async () => {
            await loadPositions();
            const request = {
                playlistId: 'xtream-1',
                selectedItem: {
                    ...seriesView(),
                    episodes: {},
                } as unknown as XtreamSerieDetailsView,
                target,
            };

            expect(state.takeResumeEpisode(request)).toBeNull();
            expect(
                state.takeResumeEpisode({
                    ...request,
                    selectedItem: seriesView(),
                })?.id
            ).toBe('2001');
        });

        it('stops resolving targets after a reset', async () => {
            await loadPositions();
            state.reset();

            expect(
                state.takeResumeEpisode({
                    playlistId: 'xtream-1',
                    selectedItem: seriesView(),
                    target,
                })
            ).toBeNull();
        });
    });

    describe('update and remove', () => {
        it('updates and removes entries by content id', () => {
            state.update(position(1001));
            expect(state.positions().get(1001)?.positionSeconds).toBe(60);

            state.remove(1001);
            expect(state.positions().has(1001)).toBe(false);
        });
    });

    describe('recordExternalLaunch', () => {
        let save: jest.Mock;

        beforeEach(() => {
            save = jest.fn().mockResolvedValue(undefined);
        });

        it('ignores launches that do not produce a session', async () => {
            await state.recordExternalLaunch(
                playback(2001),
                Promise.resolve(undefined),
                save
            );

            expect(save).not.toHaveBeenCalled();
        });

        it('ignores launches without episode content info', async () => {
            await state.recordExternalLaunch(
                playback(2001, { contentInfo: undefined }),
                Promise.resolve(session),
                save
            );
            await state.recordExternalLaunch(
                playback(2001, {
                    contentInfo: {
                        playlistId: 'xtream-1',
                        contentXtreamId: 2001,
                        contentType: 'vod',
                    } as ResolvedPortalPlayback['contentInfo'],
                }),
                Promise.resolve(session),
                save
            );

            expect(save).not.toHaveBeenCalled();
        });

        it('persists the floored requested start time', async () => {
            await state.recordExternalLaunch(
                playback(2001, { startTime: 42.9 }),
                Promise.resolve(session),
                save
            );

            expect(save).toHaveBeenCalledWith(
                'xtream-1',
                expect.objectContaining({
                    contentXtreamId: 2001,
                    positionSeconds: 42,
                })
            );
            expect(state.positions().get(2001)?.positionSeconds).toBe(42);
        });

        it('keeps the existing saved offset when the launch has none', async () => {
            state.update(
                position(2001, { positionSeconds: 84, durationSeconds: 1200 })
            );

            await state.recordExternalLaunch(
                playback(2001),
                Promise.resolve(session),
                save
            );

            expect(save).toHaveBeenCalledWith(
                'xtream-1',
                expect.objectContaining({
                    positionSeconds: 84,
                    durationSeconds: 1200,
                })
            );
        });

        it('clamps invalid start times to zero', async () => {
            await state.recordExternalLaunch(
                playback(2001, { startTime: Number.NaN }),
                Promise.resolve(session),
                save
            );
            await state.recordExternalLaunch(
                playback(2001, { startTime: -30 }),
                Promise.resolve(session),
                save
            );

            expect(save).toHaveBeenNthCalledWith(
                1,
                'xtream-1',
                expect.objectContaining({ positionSeconds: 0 })
            );
            expect(save).toHaveBeenNthCalledWith(
                2,
                'xtream-1',
                expect.objectContaining({ positionSeconds: 0 })
            );
        });
    });
});

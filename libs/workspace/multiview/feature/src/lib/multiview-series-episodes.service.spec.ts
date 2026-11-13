import { TestBed } from '@angular/core/testing';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionService, PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import { movieItem, tile } from './multiview-picker.fixtures';
import { MultiviewSeriesEpisodesService } from './multiview-series-episodes.service';
import { MultiviewUnresolvableError } from './multiview-tile-resolver';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

const series = movieItem(30, { contentType: 'series', name: 'Synthetic Show' });

function episode(id: string, season: number, number: number, extra = {}) {
    return {
        id,
        season,
        episode_num: number,
        title: `Episode ${number}`,
        container_extension: 'mkv',
        direct_source: '',
        ...extra,
    };
}

describe('MultiviewSeriesEpisodesService', () => {
    const getSeriesInfo = jest.fn();
    const getSeriesPlaybackPositions = jest.fn();
    const savePlaybackPosition = jest.fn();
    const constructEpisodeUrl = jest.fn();
    const isLocked = jest.fn();

    beforeEach(() => {
        jest.resetAllMocks();
        isLocked.mockResolvedValue(false);
        constructEpisodeUrl.mockImplementation(
            (_c: unknown, e: { id: string }) =>
                `http://xtream.example/series/u/p/${e.id}.mkv`
        );
        getSeriesInfo.mockResolvedValue({
            episodes: {
                '2': [episode('21', 2, 1)],
                '1': [episode('12', 1, 2), episode('11', 1, 1)],
            },
        });
        getSeriesPlaybackPositions.mockResolvedValue([
            {
                contentXtreamId: 12,
                contentType: 'episode',
                positionSeconds: 90,
            },
        ]);
        TestBed.configureTestingModule({
            providers: [
                { provide: XtreamApiService, useValue: { getSeriesInfo } },
                {
                    provide: XtreamUrlService,
                    useValue: { constructEpisodeUrl },
                },
                { provide: MultiviewXtreamLock, useValue: { isLocked } },
                {
                    provide: PlaybackPositionService,
                    useValue: {
                        getSeriesPlaybackPositions,
                        savePlaybackPosition,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: () =>
                            of({
                                _id: 'playlist-1',
                                serverUrl: 'http://xtream.example',
                                username: 'u',
                                password: 'p',
                            }),
                    },
                },
            ],
        });
    });

    const service = () => TestBed.inject(MultiviewSeriesEpisodesService);

    it('lists the episodes in order with saved progress and tiles', async () => {
        const rows = await service().load(series, []);

        expect(rows.map((r) => [r.season, r.number])).toEqual([
            [1, 1],
            [1, 2],
            [2, 1],
        ]);
        expect(rows[1].position?.positionSeconds).toBe(90);

        const onScreen = await service().load(series, [
            tile({ id: 'a' }),
            tile({ id: 'b', playbackSessionKey: rows[2].sessionKey }),
        ]);
        expect(onScreen[2].inTile).toBe(2);
    });

    it('lists nothing for a series of another provider', async () => {
        await expect(
            service().load({ ...series, sourceType: 'stalker' }, [])
        ).resolves.toEqual([]);
        expect(getSeriesInfo).not.toHaveBeenCalled();
    });

    it('resolves an episode that resumes and saves like the series page (R9)', async () => {
        const [, second] = await service().load(series, []);

        const source = await service().resolve(series, second);

        expect(source).toMatchObject({
            kind: 'episode',
            playlistId: 'playlist-1',
            position: 90,
            playback: {
                streamUrl: 'http://xtream.example/series/u/p/12.mkv',
                isLive: false,
                contentInfo: {
                    contentXtreamId: 12,
                    contentType: 'episode',
                    seriesXtreamId: 30,
                    seasonNumber: 1,
                    episodeNumber: 2,
                },
            },
        });
        source.persistPosition?.({ currentTime: 95, duration: 1200 });
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({
                contentXtreamId: 12,
                positionSeconds: 95,
            })
        );
    });

    it('refuses an episode of a locked series (R11)', async () => {
        const [row] = await service().load(series, []);
        isLocked.mockResolvedValue(true);

        await expect(service().resolve(series, row)).rejects.toBeInstanceOf(
            MultiviewUnresolvableError
        );
    });

    it('prefers the episode direct source', async () => {
        getSeriesInfo.mockResolvedValue({
            episodes: {
                '1': [
                    episode('11', 1, 1, {
                        direct_source: 'https://cdn.example/e11.mp4',
                    }),
                ],
            },
        });
        const [row] = await service().load(series, []);

        await expect(service().resolve(series, row)).resolves.toMatchObject({
            playback: { streamUrl: 'https://cdn.example/e11.mp4' },
        });
    });
});

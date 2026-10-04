import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import { createStalkerSeriesViewHarness } from './stalker-series-view.test-harness';

import {
    StubPortalInlinePlayerComponent,
    StubSeasonContainerComponent,
} from './stalker-series-view.test-helpers';

describe('StalkerSeriesViewComponent', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const {
        selectedContentType,
        selectedItem,
        serialSeasonsResource,
        vodSeriesSeasonsResource,
        fetchVodSeriesEpisodes,
        resolveVodPlayback,
        openResolvedPlayback,
        openExternalPlayback,
        isEmbeddedPlayer,
        fetchLinkToPlay,
        currentPlaylist,
        createFixture,
    } = createStalkerSeriesViewHarness(() => jest.fn());

    async function stabilize(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
    }

    /** Lets a start's awaited continuations run, then renders their state. */
    async function settleStart(): Promise<void> {
        await stabilize();
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
    }

    beforeEach(async () => {
        fixture = await createFixture();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('renders quick start for regular series and starts the first episode', async () => {
        await stabilize();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain('XTREAM.PLAY');
        expect(quickStartButton?.textContent).toContain('S01E01 · Episode 1');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_30001.mpg',
            'Regular Series',
            'poster.jpg',
            1,
            expect.any(Number),
            undefined
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'http://stalker.example/episode.mpg',
            }),
            true
        );
    });

    it('holds the quick-start button until the start settles', async () => {
        let finishResolve!: (playback: unknown) => void;
        resolveVodPlayback.mockImplementationOnce(
            () => new Promise((resolve) => (finishResolve = resolve))
        );
        await stabilize();
        fixture.detectChanges();
        const button = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        button()?.click();
        fixture.detectChanges();
        // A second press could not cancel the first start.
        expect(button()?.disabled).toBe(true);

        finishResolve({ streamUrl: 'http://stalker.example/episode.mpg' });
        await settleStart();
        expect(button()?.disabled).toBe(false);
        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);
    });

    it('plays an episode chosen during a forced launch once that launch settles', async () => {
        let finishLaunch!: () => void;
        openExternalPlayback.mockImplementationOnce(
            () => new Promise<void>((resolve) => (finishLaunch = resolve))
        );
        await stabilize();
        const [first, second] = fixture.componentInstance.mappedSeasons()['1'];

        fixture.componentInstance.onEpisodeClicked(first, undefined, 'mpv');
        await settleStart();
        expect(openExternalPlayback).toHaveBeenCalledTimes(1);

        // The launch IPC cannot be cancelled: the choice waits for it instead
        // of opening a second player next to the first.
        fixture.componentInstance.onEpisodeClicked(second);
        await settleStart();
        expect(resolveVodPlayback).toHaveBeenCalledTimes(1);
        expect(openResolvedPlayback).not.toHaveBeenCalled();

        finishLaunch();
        await settleStart();
        expect(resolveVodPlayback).toHaveBeenCalledTimes(2);
        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            '/media/file_30001.mpg',
            'Regular Series',
            'poster.jpg',
            2,
            expect.any(Number),
            undefined
        );
        expect(openResolvedPlayback).toHaveBeenCalledTimes(1);
    });

    it('keeps provider episodes playable while hiding download presentation', async () => {
        fixture.componentRef.setInput('providerOnly', true);

        await stabilize();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        expect(seasonContainer.downloadsEnabled()).toBe(false);
        expect(
            Object.values(
                seasonContainer.seasons() as Record<string, unknown[]>
            ).flat()
        ).toHaveLength(2);
        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            )
        ).not.toBeNull();
    });

    it('binds a Stalker adapter that prepares canonical episode metadata', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            category_id: '18',
            info: { name: 'Signal House' },
        });

        await stabilize();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        const initialAdapter = seasonContainer.downloadAdapter();
        const candidate = initialAdapter?.createCandidate(
            {
                id: '61001',
                episode_num: 3,
                title: 'The Call',
                custom_sid: 'vod-series',
                season: 2,
                originalId: '502',
            } as never,
            '2'
        );

        const request = await candidate?.prepare();

        expect(fetchLinkToPlay).toHaveBeenCalledWith(
            'https://stalker.example.test',
            '00:1A:79:12:34:56',
            '/media/file_502.mpg',
            3
        );
        expect(request).toEqual(
            expect.objectContaining({
                episodeIdentityScope: 'stalker-lazy-vod',
                playlistId: 'stalker-1',
                seriesXtreamId: 50001,
                xtreamId: 61001,
                title: 'Signal House - S02E03 - The Call',
            })
        );

        currentPlaylist.set({
            _id: 'stalker-2',
            title: 'Bedroom Portal',
            portalUrl: 'https://bedroom.example.test',
            macAddress: '00:1A:79:65:43:21',
        });
        selectedItem.set({
            id: '40002:season-slice',
            category_id: '22',
            info: { name: 'Second Signal' },
        });
        await stabilize();

        const updatedAdapter = seasonContainer.downloadAdapter();
        expect(updatedAdapter).not.toBe(initialAdapter);
        const updatedCandidate = updatedAdapter?.createCandidate(
            {
                id: '62001',
                episode_num: 1,
                title: 'Pilot',
                custom_sid: 'regular-series',
                season: 4,
                originalCmd: '/media/file_888.mpg',
            } as never,
            '4'
        );
        if (!updatedCandidate) {
            throw new Error('expected a refreshed Stalker download adapter');
        }
        const updatedRequest = await updatedCandidate.prepare();

        expect(fetchLinkToPlay).toHaveBeenLastCalledWith(
            'https://bedroom.example.test',
            '00:1A:79:65:43:21',
            '/media/file_888.mpg',
            1
        );
        expect(updatedRequest).toEqual(
            expect.objectContaining({
                episodeIdentityScope: 'stalker-regular-series',
                playlistId: 'stalker-2',
                seriesXtreamId: 40002,
                xtreamId: 62001,
                title: 'Second Signal - S04E01 - Pilot',
                portalUrl: 'https://bedroom.example.test',
                macAddress: '00:1A:79:65:43:21',
                metadataSnapshot: expect.objectContaining({
                    title: 'Second Signal',
                    providerCategoryId: '22',
                }),
            })
        );
    });

    it('interpolates the episode number for a recently started VOD is_series episode', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: '1',
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([]);

        await stabilize();
        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Pilot',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        const episode = fixture.componentInstance.mappedSeasons()['1'][0];
        fixture.componentInstance.episodePlaybackPositions.set(
            new Map([
                [
                    Number(episode.id),
                    {
                        contentXtreamId: Number(episode.id),
                        contentType: 'episode',
                        seriesXtreamId: 50001,
                        positionSeconds: 5,
                        durationSeconds: 100,
                    },
                ],
            ])
        );
        fixture.detectChanges();

        const button: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(
            fixture.componentInstance.quickStartAction()?.labelParams
        ).toEqual({ episode: 1 });
        // The hero shows "Play" with the episode on the second line.
        expect(button?.textContent).toContain('XTREAM.PLAY');
        expect(button?.textContent).toContain('S01E01 · Pilot');
        expect(button?.textContent).not.toContain('{{episode}}');
    });

    it('loads the first VOD-series season and starts its first episode from quick start', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
        ]);
        fetchVodSeriesEpisodes.mockResolvedValue([
            {
                id: 'episode-10',
                series_number: 10,
                name: 'Finale',
            },
            {
                id: 'episode-1',
                series_number: 1,
                name: 'Pilot',
            },
        ]);

        await stabilize();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain('S01E01');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-1'
        );
        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_episode-1.mpg',
            'VOD Flagged Series - Pilot',
            'vod-series.jpg',
            1,
            expect.any(Number),
            undefined
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                contentInfo: expect.objectContaining({
                    seasonNumber: 1,
                    episodeNumber: 1,
                }),
            }),
            true
        );
    });

    it('loads an earlier unloaded VOD-series season before showing completed', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
        ]);
        fetchVodSeriesEpisodes.mockResolvedValue([
            {
                id: 'episode-1',
                series_number: 1,
                name: 'Pilot',
            },
        ]);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [
                    {
                        id: 'episode-2',
                        series_number: 1,
                        name: 'Second Season Pilot',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        const watchedEpisode =
            fixture.componentInstance.mappedSeasons()['2'][0];
        const watchedPosition: PlaybackPositionData = {
            contentXtreamId: Number(watchedEpisode.id),
            contentType: 'episode',
            seriesXtreamId: 50001,
            positionSeconds: 95,
            durationSeconds: 100,
        };
        fixture.componentInstance.episodePlaybackPositions.set(
            new Map([[Number(watchedEpisode.id), watchedPosition]])
        );
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.disabled).toBe(false);
        expect(quickStartButton?.textContent).toContain('XTREAM.PLAY');
        expect(quickStartButton?.textContent).toContain('S01E01');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-1'
        );
        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_episode-1.mpg',
            'VOD Flagged Series - Pilot',
            'vod-series.jpg',
            1,
            expect.any(Number),
            undefined
        );
    });

    it('passes inline episode metadata and autoplays only loaded current-season episodes for VOD is_series playback', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Pilot',
                    },
                    {
                        id: 'episode-2',
                        series_number: 2,
                        name: 'Second',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [
                    {
                        id: 'episode-3',
                        series_number: 1,
                        name: 'Next Season',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        fetchVodSeriesEpisodes.mockClear();

        const seasonOneEpisodes =
            fixture.componentInstance.mappedSeasons()['1'];
        const firstEpisode = seasonOneEpisodes[0];
        const secondEpisode = seasonOneEpisodes[1];
        const seasonTwoEpisode =
            fixture.componentInstance.mappedSeasons()['2'][0];

        fixture.componentInstance.onEpisodeClicked(firstEpisode);
        await fixture.whenStable();
        fixture.detectChanges();

        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;

        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                contentInfo: expect.objectContaining({
                    seasonNumber: 1,
                    episodeNumber: 1,
                }),
            })
        );
        expect(inlinePlayer.episodeMetadata()).toEqual({
            label: 'S01E01',
            title: 'Pilot',
            seasonNumber: 1,
            episodeNumber: 1,
        });
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: false,
            canNext: true,
            autoplayEnabled: true,
        });
        const firstEpisodeKey = inlinePlayer.playbackSessionKey();
        expect(firstEpisodeKey).not.toBe('');

        inlinePlayer.playbackEnded.emit();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            '/media/file_episode-2.mpg',
            'VOD Flagged Series - Second',
            'vod-series.jpg',
            2,
            Number(secondEpisode.id),
            undefined
        );
        expect(inlinePlayer.episodeMetadata()).toEqual({
            label: 'S01E02',
            title: 'Second',
            seasonNumber: 1,
            episodeNumber: 2,
        });
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        expect(inlinePlayer.playbackSessionKey()).not.toBe(firstEpisodeKey);

        inlinePlayer.playbackEnded.emit();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).not.toHaveBeenCalled();
        expect(resolveVodPlayback).not.toHaveBeenCalledWith(
            '/media/file_episode-3.mpg',
            'VOD Flagged Series - Next Season',
            'vod-series.jpg',
            1,
            Number(seasonTwoEpisode.id),
            undefined
        );
    });

    it('loads the next unloaded VOD-series season after the loaded season is watched', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        fetchVodSeriesEpisodes.mockResolvedValue([
            {
                id: 'episode-2',
                series_number: 1,
                name: 'Second Season Pilot',
            },
        ]);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    {
                        id: 'episode-1',
                        series_number: 1,
                        name: 'Pilot',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        const watchedEpisode =
            fixture.componentInstance.mappedSeasons()['1'][0];
        const watchedPosition: PlaybackPositionData = {
            contentXtreamId: Number(watchedEpisode.id),
            contentType: 'episode',
            seriesXtreamId: 50001,
            positionSeconds: 95,
            durationSeconds: 100,
        };
        fixture.componentInstance.episodePlaybackPositions.set(
            new Map([[Number(watchedEpisode.id), watchedPosition]])
        );
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain('XTREAM.PLAY');
        expect(quickStartButton?.textContent).toContain('S02E01');

        quickStartButton?.click();
        await fixture.whenStable();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-2'
        );
        expect(resolveVodPlayback).toHaveBeenCalledWith(
            '/media/file_episode-2.mpg',
            'VOD Flagged Series - Second Season Pilot',
            'vod-series.jpg',
            1,
            expect.any(Number),
            undefined
        );
    });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { SerialDetailsComponent } from './serial-details.component';
import { SerialDetailsMenuService } from './serial-details-menu.service';
import { SerialDetailsPlaybackService } from './serial-details-playback.service';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import {
    configureSerialDetailsTestBed,
    createSerialDetailsStubs,
    resetSerialDetailsStubs,
} from './serial-details.harness';
import {
    StubPortalInlinePlayerComponent,
    StubSeasonContainerComponent,
} from './serial-details.test-stubs';

describe('SerialDetailsComponent', () => {
    let fixture: ComponentFixture<SerialDetailsComponent>;
    const stubs = createSerialDetailsStubs();
    const {
        selectedItem,
        currentPlaylist,
        fetchSerialDetailsWithMetadata,
        cancelDetailsRequest,
        checkFavoriteStatus,
        constructEpisodeStreamUrl,
        addRecentItem,
        openResolvedPlayback,
        openExternalPlayback,
        savePlaybackPosition,
        isEmbeddedPlayer,
        getSeriesPlaybackPositions,
        seriesResumeTarget,
        routeParams,
    } = stubs;

    beforeEach(async () => {
        window.history.replaceState({}, '', window.location.href);
        resetSerialDetailsStubs(stubs);
        await configureSerialDetailsTestBed(stubs);

        fixture = TestBed.createComponent(SerialDetailsComponent);
    });

    afterEach(() => {
        window.history.replaceState({}, '', window.location.href);
        fixture?.destroy();
    });

    it('initializes series metadata and renders the season container', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fetchSerialDetailsWithMetadata).toHaveBeenCalledWith({
            serialId: '103',
            categoryId: 3,
        });
        expect(checkFavoriteStatus).toHaveBeenCalledWith(
            103,
            'xtream-1',
            'series'
        );
        expect(getSeriesPlaybackPositions).toHaveBeenCalledWith(
            'xtream-1',
            103
        );

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        )?.componentInstance as StubSeasonContainerComponent | undefined;

        expect(seasonContainer).toBeDefined();
        expect(seasonContainer?.seriesId()).toBe(103);
        expect(seasonContainer?.playlistId()).toBe('xtream-1');
        expect(seasonContainer?.seasons()).toEqual({
            '1': [
                {
                    id: '1001',
                    episode_num: 1,
                    title: 'Episode 1',
                    season: 1,
                },
                {
                    id: '1002',
                    episode_num: 2,
                    title: 'Episode 2',
                    season: 1,
                },
            ],
            '2': [
                {
                    id: '2001',
                    episode_num: 1,
                    title: 'Season 2 Episode 1',
                    season: 2,
                },
            ],
        });
        expect(seasonContainer?.downloadsEnabled()).toBe(true);
        const adapter = seasonContainer?.downloadAdapter();
        const candidate = adapter?.createCandidate(
            (
                seasonContainer?.seasons() as Record<
                    string,
                    Array<Record<string, unknown>>
                >
            )['1'][0] as never,
            '1'
        );
        expect(candidate?.identity).toEqual({
            playlistId: 'xtream-1',
            contentType: 'episode',
            xtreamId: 1001,
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
        });
        await expect(candidate?.prepare()).resolves.toEqual({
            playlistId: 'xtream-1',
            xtreamId: 1001,
            contentType: 'episode',
            title: 'Series One - S01E01 - Episode 1',
            url: 'http://xtream.example/series/user/pass/1001.mp4',
            posterUrl: undefined,
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
            headers: {
                userAgent: 'ProtectedProvider/2.0',
                referer: 'https://referrer.example/series',
                origin: 'https://origin.example',
            },
            metadataSnapshot: {
                version: 1,
                language: 'en',
                mediaKind: 'series',
                title: 'Series One',
                plot: 'Series plot',
                genres: ['Drama'],
                tmdbId: 901,
                providerCategoryId: '3',
                cast: [{ name: 'Sienna Wave', role: 'Mara' }],
                episode: {
                    seasonNumber: 1,
                    episodeNumber: 1,
                    title: 'Episode 1',
                },
                enrichedAt: expect.any(String),
            },
        });
    });

    it('filters URL-only season overviews and falls back to TMDB descriptions', async () => {
        selectedItem.set({
            series_id: 103,
            info: {
                name: 'Series One',
                plot: 'Series plot',
                cover: 'cover.jpg',
                backdrop_path: [],
                genre: 'Drama',
                category_id: '3',
            },
            seasons: [
                {
                    season_number: 1,
                    overview:
                        'http://line.example.net:80/images/series/cover_small.jpg',
                },
                {
                    season_number: 2,
                    overview: 'Provider season 2 text',
                },
            ],
            tmdb_season_overviews: {
                '1': 'TMDB season 1 overview',
                '2': 'TMDB season 2 overview',
            },
            episodes: {
                '1': [{ id: '1001', episode_num: 1, title: 'E1', season: 1 }],
                '2': [{ id: '2001', episode_num: 1, title: 'E1', season: 2 }],
            },
        });

        fixture.detectChanges();
        await fixture.whenStable();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        )?.componentInstance as StubSeasonContainerComponent;

        // The bare cover URL is junk → TMDB fills season 1; real provider
        // text keeps priority over TMDB for season 2.
        expect(seasonContainer.seasonDescriptions()).toEqual({
            '1': 'TMDB season 1 overview',
            '2': 'Provider season 2 text',
        });
    });

    it('keeps every provider episode but disables download presentation in provider-only mode', async () => {
        window.history.replaceState(
            { detailPresentation: 'provider-only' },
            '',
            window.location.href
        );

        fixture.detectChanges();
        await fixture.whenStable();

        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        )?.componentInstance as StubSeasonContainerComponent;
        expect(fixture.componentInstance.providerOnly()).toBe(true);
        expect(seasonContainer.downloadsEnabled()).toBe(false);
        expect(
            Object.values(
                seasonContainer.seasons() as Record<string, unknown[]>
            ).flat()
        ).toHaveLength(3);
    });

    it('invalidates an in-flight detail request on teardown', () => {
        fixture.componentInstance.ngOnDestroy();

        expect(cancelDetailsRequest).toHaveBeenCalledTimes(1);
    });

    it('renders series metadata when backdrop_path is absent at runtime', () => {
        selectedItem.set({
            series_id: 103,
            info: {
                name: 'Series Without Backdrop',
                plot: 'Series plot',
                cover: 'cover.jpg',
                genre: 'Drama',
            },
            episodes: {},
        });

        expect(() => fixture.detectChanges()).not.toThrow();

        const hero = fixture.debugElement.query(
            By.directive(ContentHeroComponent)
        ).componentInstance as ContentHeroComponent;
        expect(hero.backdropUrl()).toBeUndefined();
    });

    it('renders quick start as the first episode action and opens that episode', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton).not.toBeNull();
        expect(quickStartButton?.textContent).toContain('XTREAM.PLAY');
        expect(quickStartButton?.textContent).toContain('S01E01 · Episode 1');

        quickStartButton?.click();

        expect(constructEpisodeStreamUrl).toHaveBeenCalledWith(
            expect.objectContaining({ id: '1001' })
        );
        // The series is a recent view only once the episode has played.
        expect(addRecentItem).not.toHaveBeenCalled();
        TestBed.inject(PlaybackHistoryGate).confirm({
            streamUrls: ['http://xtream.example/series/1001.mp4'],
        });
        expect(addRecentItem).toHaveBeenCalledWith({
            xtreamId: '103',
            contentType: 'series',
            playlist: expect.any(Function),
            backdropUrl: undefined,
        });
        expect(addRecentItem.mock.calls[0][0].playlist()).toEqual(
            currentPlaylist()
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1001.mp4',
                title: 'Episode 1',
                startTime: undefined,
                contentInfo: expect.objectContaining({
                    contentXtreamId: 1001,
                    contentType: 'episode',
                    seriesXtreamId: 103,
                }),
            }),
            true
        );
    });

    it('resumes quick start from the stored episode position', async () => {
        getSeriesPlaybackPositions.mockResolvedValue([
            {
                contentXtreamId: 1001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 1,
                episodeNumber: 1,
                positionSeconds: 42,
                durationSeconds: 120,
                playlistId: 'xtream-1',
                updatedAt: '2026-05-10T12:00:00.000Z',
            },
        ]);

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );

        expect(quickStartButton?.textContent).toContain(
            'WORKSPACE.DASHBOARD.HERO_CONTINUE'
        );
        expect(quickStartButton?.textContent).toContain('S01E01');

        quickStartButton?.click();

        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                startTime: 42,
                contentInfo: expect.objectContaining({
                    contentXtreamId: 1001,
                }),
            }),
            true
        );
    });

    it('records the selected episode after a successful external-player launch', async () => {
        openResolvedPlayback.mockResolvedValue({
            id: 'vlc-session-1',
            player: 'vlc',
            status: 'opened',
            title: 'Season 2 Episode 1',
            streamUrl: 'http://xtream.example/series/2001.mp4',
            startedAt: '2026-07-14T10:00:00.000Z',
            updatedAt: '2026-07-14T10:00:00.000Z',
            canClose: true,
        });
        fixture.detectChanges();
        await fixture.whenStable();

        fixture.componentInstance.playEpisode({
            id: '2001',
            episode_num: 1,
            title: 'Season 2 Episode 1',
            season: 2,
        } as never);
        await fixture.whenStable();
        // The launch settles through its page checks before the save.
        await new Promise((resolve) => setTimeout(resolve));

        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                playlistId: 'xtream-1',
                contentXtreamId: 2001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 2,
                episodeNumber: 1,
                positionSeconds: 0,
                updatedAt: expect.any(String),
            })
        );
        // The launched episode's position lands two microtasks after the
        // save: `recordExternalLaunch` awaits the launch, then the save.
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
        const quickStartButton: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );
        expect(quickStartButton?.textContent).toContain('XTREAM.PLAY');
        expect(quickStartButton?.textContent).toContain(
            'S02E01 \u00b7 Season 2 Episode 1'
        );
    });

    it('automatically resumes the exact dashboard episode after positions load', async () => {
        getSeriesPlaybackPositions.mockResolvedValue([
            {
                contentXtreamId: 2001,
                contentType: 'episode',
                seriesXtreamId: 103,
                seasonNumber: 2,
                episodeNumber: 1,
                positionSeconds: 84,
                durationSeconds: 1200,
                playlistId: 'xtream-1',
                updatedAt: '2026-05-10T12:00:00.000Z',
            },
        ]);
        seriesResumeTarget.set({
            seriesXtreamId: 103,
            contentXtreamId: 2001,
            seasonNumber: 2,
            episodeNumber: 1,
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(constructEpisodeStreamUrl).toHaveBeenCalledTimes(1);
        expect(constructEpisodeStreamUrl).toHaveBeenCalledWith(
            expect.objectContaining({
                id: '2001',
                season: 2,
                episode_num: 1,
            })
        );
        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/2001.mp4',
                startTime: 84,
                contentInfo: expect.objectContaining({
                    contentXtreamId: 2001,
                    seriesXtreamId: 103,
                    seasonNumber: 2,
                    episodeNumber: 1,
                }),
            }),
            true
        );
    });

    it('does not auto-resume the dashboard episode when positions fail to load', async () => {
        const warnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        getSeriesPlaybackPositions.mockRejectedValue(
            new Error('storage unavailable')
        );
        seriesResumeTarget.set({
            seriesXtreamId: 103,
            contentXtreamId: 2001,
            seasonNumber: 2,
            episodeNumber: 1,
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(constructEpisodeStreamUrl).not.toHaveBeenCalled();
        expect(openResolvedPlayback).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('applies streamed playback-position updates for the selected series only', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const positionUpdateCallback = stubs.positionUpdates.callback;
        if (!positionUpdateCallback) {
            throw new Error('expected a playback-position subscription');
        }

        positionUpdateCallback({
            playlistId: 'other-playlist',
            contentXtreamId: 1001,
            contentType: 'episode',
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
            positionSeconds: 300,
            durationSeconds: 1200,
        } as PlaybackPositionData);
        fixture.detectChanges();

        const quickStartButton = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-testid="series-quick-start"]'
            );
        expect(quickStartButton()?.textContent).not.toContain(
            'WORKSPACE.DASHBOARD.HERO_CONTINUE'
        );

        positionUpdateCallback({
            playlistId: 'xtream-1',
            contentXtreamId: 1001,
            contentType: 'episode',
            seriesXtreamId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
            positionSeconds: 300,
            durationSeconds: 1200,
        } as PlaybackPositionData);
        fixture.detectChanges();

        expect(quickStartButton()?.textContent).toContain(
            'WORKSPACE.DASHBOARD.HERO_CONTINUE'
        );
        expect(quickStartButton()?.textContent).toContain('S01E01');
    });

    it('records history when the menu opens the next episode in MPV', async () => {
        const streamUrl = 'http://xtream.example/series/1001.mp4';
        fixture.detectChanges();
        await fixture.whenStable();
        const menu = fixture.debugElement.injector.get(
            SerialDetailsMenuService
        );
        await menu.run('external-player');
        await fixture.whenStable();

        // The regular episode start with the player forced: same history
        // and launch-position bookkeeping as the Play button.
        expect(openResolvedPlayback).not.toHaveBeenCalled();
        expect(openExternalPlayback).toHaveBeenCalledWith(
            expect.objectContaining({ streamUrl }),
            'mpv'
        );
        TestBed.inject(PlaybackHistoryGate).confirm({
            streamUrls: [streamUrl],
        });
        expect(addRecentItem).toHaveBeenCalledWith(
            expect.objectContaining({ xtreamId: '103', contentType: 'series' })
        );
    });

    it('persists the launched episode after an external fallback succeeds', async () => {
        openExternalPlayback.mockResolvedValue({
            id: 'mpv-session-1',
            player: 'mpv',
            status: 'opened',
        });
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );
        const trackLaunch = jest.fn();
        playbackService.handleExternalFallbackRequest({
            player: 'mpv',
            trackLaunch,
            playback: {
                streamUrl: 'http://xtream.example/series/2001.mp4',
                title: 'Season 2 Episode 1',
                contentInfo: {
                    playlistId: 'xtream-1',
                    contentXtreamId: 2001,
                    contentType: 'episode',
                    seriesXtreamId: 103,
                    seasonNumber: 2,
                    episodeNumber: 1,
                },
            },
            diagnostic: {},
        } as never);
        await fixture.whenStable();

        expect(openExternalPlayback).toHaveBeenCalledTimes(1);
        expect(trackLaunch).toHaveBeenCalledWith(
            openExternalPlayback.mock.results[0].value
        );
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                contentXtreamId: 2001,
                contentType: 'episode',
                positionSeconds: 0,
            })
        );
    });

    it('persists throttled inline time updates for the playing episode', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        fixture.detectChanges();
        await fixture.whenStable();

        const playbackService = fixture.debugElement.injector.get(
            SerialDetailsPlaybackService
        );

        // Without an inline playback there is nothing to persist.
        playbackService.handleInlineTimeUpdate({
            currentTime: 10,
            duration: 100,
        });
        expect(savePlaybackPosition).not.toHaveBeenCalled();

        fixture.componentInstance.playEpisode({
            id: '1001',
            episode_num: 1,
            title: 'Episode 1',
            season: 1,
        } as never);
        playbackService.handleInlineTimeUpdate({
            currentTime: 123.9,
            duration: 1200.4,
        });
        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                contentXtreamId: 1001,
                positionSeconds: 123,
                durationSeconds: 1200,
            })
        );

        // A second update inside the 15s throttle window is skipped.
        savePlaybackPosition.mockClear();
        playbackService.handleInlineTimeUpdate({
            currentTime: 130,
            duration: 1200,
        });
        expect(savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('passes inline episode metadata and autoplays only inside the current season', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        fixture.detectChanges();
        await fixture.whenStable();

        const episodes = (fixture.componentInstance.selectedItem()?.episodes ??
            {}) as Record<string, Array<{ id: string; title: string }>>;
        fixture.componentInstance.playEpisode(episodes['1'][0] as never);
        fixture.detectChanges();

        let inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        expect(inlinePlayer.episodeMetadata()).toEqual({
            label: 'S01E01',
            title: 'Episode 1',
            seasonNumber: 1,
            episodeNumber: 1,
        });
        const firstEpisodeKey = createPlaybackSessionKey({
            kind: 'episode',
            sourceId: 'xtream-1',
            contentId: 1001,
            seriesId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
        });
        expect(inlinePlayer.playbackSessionKey()).toBe(firstEpisodeKey);
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: false,
            canNext: true,
            autoplayEnabled: true,
        });

        inlinePlayer.playbackEnded.emit();
        fixture.detectChanges();

        inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1002.mp4',
                title: 'Episode 2',
                contentInfo: expect.objectContaining({
                    contentXtreamId: 1002,
                    seasonNumber: 1,
                    episodeNumber: 2,
                }),
            })
        );
        expect(inlinePlayer.seriesNavigation()).toEqual({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        expect(inlinePlayer.playbackSessionKey()).not.toBe(firstEpisodeKey);

        inlinePlayer.playbackEnded.emit();
        fixture.detectChanges();

        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                streamUrl: 'http://xtream.example/series/1002.mp4',
            })
        );
        expect(constructEpisodeStreamUrl).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: '2001' })
        );
    });

    it('owns the parent identity from the route and ignores replacement playback payloads', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        fixture.detectChanges();
        await fixture.whenStable();
        const item = fixture.componentInstance.selectedItem();
        const episode = item?.episodes?.['1'][0];
        if (!item || !episode) {
            throw new Error('Expected the serial fixture and first episode');
        }
        fixture.componentInstance.playEpisode(episode);
        fixture.detectChanges();
        const expected = createPlaybackSessionKey({
            kind: 'episode',
            sourceId: 'xtream-1',
            contentId: 1001,
            seriesId: 103,
            seasonNumber: 1,
            episodeNumber: 1,
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(expected);

        fixture.componentInstance.inlinePlayback.set({
            streamUrl: 'https://alternative.example/replaced.mkv',
            title: 'Alternative payload',
            headers: { Authorization: 'Bearer replacement' },
            contentInfo: {
                playlistId: 'alternative-playlist',
                contentXtreamId: 999001,
                contentType: 'episode',
                seriesXtreamId: 999,
                seasonNumber: 9,
                episodeNumber: 9,
            },
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(expected);

        selectedItem.set({ ...item, series_id: 999 });
        routeParams.next({ categoryId: '3', serialId: '104' });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.componentInstance.playEpisode(episode);
        fixture.detectChanges();

        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'episode',
                sourceId: 'xtream-1',
                contentId: 1001,
                seriesId: 104,
                seasonNumber: 1,
                episodeNumber: 1,
            })
        );
    });
});

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { SeasonContainerComponent } from '@iptvnator/ui/components';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { EMPTY, of } from 'rxjs';
import { FavoritesButtonComponent } from '../stalker-favorites-button/stalker-favorites-button.component';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import {
    StubFavoritesButtonComponent,
    StubPortalInlinePlayerComponent,
    StubSeasonContainerComponent,
} from './stalker-series-view.test-helpers';

/**
 * The slice of a Jest mock the harness drives. This file is part of the
 * library's own type-check, which has no Jest globals, so a spec hands in
 * the factory (`() => jest.fn()`) and gets its own mock type back.
 */
export interface StalkerSeriesViewTestMock {
    mockReset(): this;
    mockClear(): this;
    mockReturnValue(value: unknown): this;
    mockResolvedValue(value: unknown): this;
    mockImplementation(implementation: (...args: never[]) => unknown): this;
}

/**
 * The TestBed the Stalker series-view component specs share: the store
 * signals and collaborator mocks a case drives, and `createFixture()`, which
 * puts them back to the state every case starts from (a regular series with
 * one two-episode season, no embedded player) before building the component
 * with its stubbed children.
 *
 * Call it once per `describe`; the mocks live as long as that block.
 */
export function createStalkerSeriesViewHarness<
    TMock extends StalkerSeriesViewTestMock,
>(createMock: () => TMock) {
    const selectedContentType = signal<'series' | 'vod'>('series');
    const selectedItem = signal<StalkerVodSource | null>(null);
    const serialSeasonsResource = signal<unknown[]>([]);
    const vodSeriesSeasonsResource = signal<unknown[]>([]);
    const isSerialSeasonsLoading = signal(false);
    const fetchVodSeriesEpisodes = createMock();
    const resolveVodPlayback = createMock();
    const getSeriesPlaybackPositions = createMock().mockResolvedValue([]);
    const openResolvedPlayback = createMock();
    const openExternalPlayback = createMock();
    const isEmbeddedPlayer = createMock();
    const tmdbGetSeason = createMock();
    const fetchLinkToPlay = createMock();
    const currentPlaylist = signal({
        _id: 'stalker-1',
        title: 'Living Room Portal',
        portalUrl: 'https://stalker.example.test',
        macAddress: '00:1A:79:12:34:56',
    });

    async function createFixture(): Promise<
        ComponentFixture<StalkerSeriesViewComponent>
    > {
        selectedContentType.set('series');
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                description: 'Series description',
                movie_image: 'poster.jpg',
            },
        });
        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_30001.mpg',
                series: [1, 2],
            },
        ]);
        vodSeriesSeasonsResource.set([]);
        isSerialSeasonsLoading.set(false);
        fetchVodSeriesEpisodes.mockReset();
        resolveVodPlayback.mockReset();
        resolveVodPlayback.mockImplementation(
            async (
                _cmd?: string,
                title?: string,
                thumbnail?: string,
                _episodeNum?: number,
                episodeId?: number,
                startTime?: number
            ) => ({
                streamUrl: 'http://stalker.example/episode.mpg',
                title: title ?? 'Regular Series',
                thumbnail: thumbnail ?? 'poster.jpg',
                startTime,
                contentInfo: {
                    playlistId: 'stalker-1',
                    contentXtreamId:
                        episodeId ?? Number(selectedItem()?.id ?? 0),
                    contentType: episodeId ? 'episode' : 'vod',
                    seriesXtreamId: episodeId
                        ? Number(selectedItem()?.id ?? 0)
                        : undefined,
                },
            })
        );
        getSeriesPlaybackPositions.mockClear();
        getSeriesPlaybackPositions.mockResolvedValue([]);
        openResolvedPlayback.mockClear();
        openExternalPlayback.mockReset();
        isEmbeddedPlayer.mockReset();
        isEmbeddedPlayer.mockReturnValue(false);
        tmdbGetSeason.mockReset();
        tmdbGetSeason.mockResolvedValue({
            overview: 'Season overview from TMDB',
            episodes: [],
        });
        fetchLinkToPlay
            .mockReset()
            .mockResolvedValue('https://cdn.example.test/episode.mpg');
        currentPlaylist.set({
            _id: 'stalker-1',
            title: 'Living Room Portal',
            portalUrl: 'https://stalker.example.test',
            macAddress: '00:1A:79:12:34:56',
        });

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType,
                        currentPlaylist,
                        getSerialSeasonsResource: () => serialSeasonsResource(),
                        getVodSeriesSeasonsResource: () =>
                            vodSeriesSeasonsResource(),
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading,
                        fetchVodSeriesEpisodes,
                        resolveVodPlayback,
                        fetchLinkToPlay,
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getSeriesPlaybackPositions,
                        savePlaybackPosition: createMock(),
                        clearPlaybackPosition: createMock(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer,
                        openResolvedPlayback,
                        openExternalPlayback,
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        navigateByUrl: createMock(),
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => true,
                        getSeason: tmdbGetSeason,
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: createMock(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        currentLang: 'en',
                        defaultLang: 'en',
                        // EMPTY (not of(null)): the real TranslatePipe inside
                        // the detail shell reads `event.lang` from emissions.
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                    },
                },
            ],
        })
            .overrideComponent(StalkerSeriesViewComponent, {
                remove: {
                    imports: [
                        FavoritesButtonComponent,
                        PortalInlinePlayerComponent,
                        SeasonContainerComponent,
                        TranslatePipe,
                    ],
                },
                add: {
                    imports: [
                        StubFavoritesButtonComponent,
                        StubPortalInlinePlayerComponent,
                        StubSeasonContainerComponent,
                        MockPipe(
                            TranslatePipe,
                            (
                                value: string | null | undefined,
                                params?: Record<string, number>
                            ) => {
                                if (value === 'XTREAM.PLAY_EPISODE') {
                                    return `Play episode ${
                                        params?.['episode'] ?? '{{episode}}'
                                    }`;
                                }
                                return value ?? '';
                            }
                        ),
                    ],
                },
            })
            .compileComponents();

        return TestBed.createComponent(StalkerSeriesViewComponent);
    }

    return {
        selectedContentType,
        selectedItem,
        serialSeasonsResource,
        vodSeriesSeasonsResource,
        isSerialSeasonsLoading,
        fetchVodSeriesEpisodes,
        resolveVodPlayback,
        getSeriesPlaybackPositions,
        openResolvedPlayback,
        openExternalPlayback,
        isEmbeddedPlayer,
        tmdbGetSeason,
        fetchLinkToPlay,
        currentPlaylist,
        createFixture,
    };
}

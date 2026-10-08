import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    SeriesResumeTarget,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    SettingsStore,
} from '@iptvnator/services';
import {
    PlaybackPositionData,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SeasonContainerComponent } from '@iptvnator/ui/components';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { SerialDetailsComponent } from './serial-details.component';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import {
    StubMatIconComponent,
    StubPortalInlinePlayerComponent,
    StubSeasonContainerComponent,
} from './serial-details.test-stubs';

/**
 * The TestBed every series-details component spec needs.
 *
 * The page pulls in the store, the playback ports, the position bridge,
 * downloads, settings and the router, so standing it up costs ~200 lines.
 * One harness keeps the specs split by concern from carrying a copy each.
 */

/** The series every spec starts from: two seasons, three episodes. */
function createSeriesFixture(): unknown {
    return {
        series_id: 103,
        info: {
            name: 'Series One',
            plot: 'Series plot',
            cover: 'cover.jpg',
            backdrop_path: [],
            genre: 'Drama',
            category_id: '3',
            tmdb_id: 901,
            tmdb_cast: [{ name: 'Sienna Wave', character: 'Mara' }],
        },
        episodes: {
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
        },
    };
}

const initialPlaylist = {
    id: 'xtream-1',
    serverUrl: 'http://xtream.example',
    username: 'user',
    password: 'pass',
    userAgent: 'ProtectedProvider/2.0',
    referrer: 'https://referrer.example/series',
    origin: 'https://origin.example',
};

/** Every stub the harness installs, so specs can drive and assert on them. */
export function createSerialDetailsStubs() {
    return {
        selectedItem: signal<unknown>(null),
        selectedContentType: signal<'series'>('series'),
        isFavorite: signal(false),
        isLoadingDetails: signal(false),
        detailsError: signal<string | null>(null),
        currentPlaylist: signal(initialPlaylist),
        fetchSerialDetailsWithMetadata: jest.fn(),
        cancelDetailsRequest: jest.fn(),
        checkFavoriteStatus: jest.fn(),
        constructEpisodeStreamUrl: jest.fn(),
        addRecentItem: jest.fn(),
        openResolvedPlayback: jest.fn(),
        openExternalPlayback: jest.fn(),
        savePlaybackPosition: jest.fn(),
        clearPlaybackPosition: jest.fn(),
        savePlaybackPositionsBatch: jest.fn(),
        clearPlaybackPositionsBatch: jest.fn(),
        loadAllPositions: jest.fn(),
        isEmbeddedPlayer: jest.fn(),
        getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
        seriesResumeTarget: signal<SeriesResumeTarget | null>(null),
        routeParams: new BehaviorSubject({
            categoryId: '3',
            serialId: '103',
        }),
        /** The page's subscription to streamed position updates, once made. */
        positionUpdates: {
            callback: null as ((data: PlaybackPositionData) => void) | null,
        },
    };
}

export type SerialDetailsStubs = ReturnType<typeof createSerialDetailsStubs>;

/** Back to the state a fresh `beforeEach` expects. */
export function resetSerialDetailsStubs(stubs: SerialDetailsStubs): void {
    stubs.selectedItem.set(createSeriesFixture());
    stubs.isFavorite.set(false);
    stubs.isLoadingDetails.set(false);
    stubs.detailsError.set(null);
    stubs.currentPlaylist.set(initialPlaylist);
    stubs.fetchSerialDetailsWithMetadata.mockClear();
    stubs.cancelDetailsRequest.mockClear();
    stubs.checkFavoriteStatus.mockClear();
    stubs.constructEpisodeStreamUrl.mockReset();
    stubs.constructEpisodeStreamUrl.mockImplementation(
        (episode: { id: string | number }) =>
            `http://xtream.example/series/${episode.id}.mp4`
    );
    stubs.addRecentItem.mockClear();
    stubs.openResolvedPlayback.mockReset();
    stubs.openResolvedPlayback.mockResolvedValue(undefined);
    stubs.openExternalPlayback.mockReset();
    stubs.openExternalPlayback.mockResolvedValue(undefined);
    stubs.savePlaybackPosition.mockReset();
    stubs.savePlaybackPosition.mockResolvedValue(undefined);
    stubs.clearPlaybackPosition.mockReset();
    stubs.clearPlaybackPosition.mockResolvedValue(undefined);
    stubs.savePlaybackPositionsBatch.mockReset();
    stubs.savePlaybackPositionsBatch.mockResolvedValue(undefined);
    stubs.clearPlaybackPositionsBatch.mockReset();
    stubs.clearPlaybackPositionsBatch.mockResolvedValue(undefined);
    stubs.loadAllPositions.mockReset();
    stubs.loadAllPositions.mockResolvedValue(undefined);
    stubs.positionUpdates.callback = null;
    stubs.isEmbeddedPlayer.mockReset();
    stubs.isEmbeddedPlayer.mockReturnValue(false);
    stubs.getSeriesPlaybackPositions.mockClear();
    stubs.getSeriesPlaybackPositions.mockResolvedValue([]);
    stubs.seriesResumeTarget.set(null);
    stubs.routeParams.next({ categoryId: '3', serialId: '103' });
}

export async function configureSerialDetailsTestBed(
    stubs: SerialDetailsStubs
): Promise<void> {
    await TestBed.configureTestingModule({
        imports: [SerialDetailsComponent],
        providers: [
            {
                provide: ActivatedRoute,
                useValue: {
                    params: stubs.routeParams,
                    snapshot: {
                        params: {
                            categoryId: '3',
                            serialId: '103',
                        },
                    },
                },
            },
            {
                provide: XtreamStore,
                useValue: {
                    selectedItem: stubs.selectedItem,
                    selectedContentType: stubs.selectedContentType,
                    isFavorite: stubs.isFavorite,
                    isLoadingDetails: stubs.isLoadingDetails,
                    detailsError: stubs.detailsError,
                    currentPlaylist: stubs.currentPlaylist,
                    fetchSerialDetailsWithMetadata:
                        stubs.fetchSerialDetailsWithMetadata,
                    cancelDetailsRequest: stubs.cancelDetailsRequest,
                    checkFavoriteStatus: stubs.checkFavoriteStatus,
                    setSelectedItem: jest.fn((value: unknown) =>
                        stubs.selectedItem.set(value)
                    ),
                    toggleFavorite: jest.fn(),
                    constructEpisodeStreamUrl: stubs.constructEpisodeStreamUrl,
                    addRecentItem: stubs.addRecentItem,
                    backfillContentMetadata: jest.fn(),
                    loadAllPositions: stubs.loadAllPositions,
                    recentItems: signal([]),
                    serialCategories: signal([]),
                    loadRecentItems: jest.fn(),
                },
            },
            {
                provide: SettingsStore,
                useValue: { player: signal(VideoPlayer.Html5Player) },
            },
            {
                provide: DownloadsService,
                useValue: { isAvailable: signal(false) },
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
                    getSeriesPlaybackPositions:
                        stubs.getSeriesPlaybackPositions,
                    savePlaybackPosition: stubs.savePlaybackPosition,
                    clearPlaybackPosition: stubs.clearPlaybackPosition,
                    savePlaybackPositionsBatch:
                        stubs.savePlaybackPositionsBatch,
                    clearPlaybackPositionsBatch:
                        stubs.clearPlaybackPositionsBatch,
                },
            },
            {
                provide: PORTAL_PLAYER,
                useValue: {
                    isEmbeddedPlayer: stubs.isEmbeddedPlayer,
                    openResolvedPlayback: stubs.openResolvedPlayback,
                    openExternalPlayback: stubs.openExternalPlayback,
                },
            },
            {
                provide: PlaybackPositionRuntimeBridgeService,
                useValue: {
                    onPlaybackPositionUpdate: (
                        callback: (data: PlaybackPositionData) => void
                    ) => {
                        stubs.positionUpdates.callback = callback;
                        return () => {
                            stubs.positionUpdates.callback = null;
                        };
                    },
                },
            },
            {
                provide: XTREAM_SERIES_RESUME_TARGET,
                useValue: stubs.seriesResumeTarget,
            },
            {
                provide: MatSnackBar,
                useValue: {
                    open: jest.fn(),
                },
            },
            {
                provide: TranslateService,
                useValue: {
                    instant: (key: string) => key,
                    get: (key: string) => of(key),
                    stream: (key: string) => of(key),
                    onLangChange: EMPTY,
                    onTranslationChange: EMPTY,
                    onDefaultLangChange: EMPTY,
                },
            },
            {
                provide: Location,
                useValue: {
                    back: jest.fn(),
                },
            },
        ],
    })
        .overrideComponent(SerialDetailsComponent, {
            remove: {
                imports: [
                    MatIcon,
                    PortalInlinePlayerComponent,
                    SeasonContainerComponent,
                    TranslatePipe,
                ],
            },
            add: {
                imports: [
                    StubMatIconComponent,
                    StubPortalInlinePlayerComponent,
                    StubSeasonContainerComponent,
                    MockPipe(
                        TranslatePipe,
                        (value: string | null | undefined) => value ?? ''
                    ),
                ],
            },
        })
        .compileComponents();
}

import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { VodDetailsRouteComponent } from './vod-details-route.component';

/**
 * The TestBed every VOD-details route spec needs.
 *
 * The route pulls in the store, both playback ports, downloads, settings and
 * the router, so standing it up costs ~150 lines. Three specs carried their
 * own near-identical copy of that, which is how they drifted and how each one
 * ran into the file-size rule. One harness, one set of stubs.
 */

/** Every stub the harness installs, so specs can drive and assert on them. */
export function createVodDetailsRouteStubs() {
    return {
        routeParams: new BehaviorSubject({
            vodId: '650020',
            categoryId: '235',
        }),
        selectedItem: signal<XtreamVodDetails | null>(null),
        isLoadingDetails: signal(false),
        detailsError: signal<string | null>(null),
        isFavorite: signal(false),
        currentPlaylist: signal<{
            id: string;
            userAgent?: string;
            referrer?: string;
            origin?: string;
        } | null>(null),
        vodStreams: signal<Partial<XtreamVodStream>[]>([]),
        vodCategories: signal<Partial<XtreamCategory>[]>([]),
        fetchVodDetailsWithMetadata: jest.fn(),
        checkFavoriteStatus: jest.fn(),
        setSelectedItem: jest.fn(),
        toggleFavorite: jest.fn(),
        constructVodStreamUrl: jest
            .fn()
            .mockReturnValue('http://example.com/movie/650020.mp4'),
        addRecentItem: jest.fn(),
        cancelDetailsRequest: jest.fn(),
        vodStreamsPlaylistId: signal<string | null>(null),
        vodCategoriesPlaylistId: signal<string | null>(null),
        downloadsAvailable: signal(false),
        downloads: signal([]),
        isDownloaded: jest.fn().mockReturnValue(false),
        isDownloading: jest.fn().mockReturnValue(false),
        isPausedDownload: jest.fn().mockReturnValue(false),
        resumeDownloadByContent: jest.fn().mockResolvedValue(undefined),
        getDownloadedFilePath: jest.fn(),
        playDownload: jest.fn().mockResolvedValue(undefined),
        getPlaybackPosition: jest.fn().mockResolvedValue(null),
        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
        activeSession: signal<unknown>(null),
        closeSession: jest.fn(),
        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
        openResolvedPlayback: jest.fn(),
        openExternalPlayback: jest.fn(),
        snackBarOpen: jest.fn(),
        startDownload: jest.fn().mockResolvedValue(undefined),
        locationBack: jest.fn(),
        selectedPlayer: signal<VideoPlayer>(VideoPlayer.Html5Player),
        updateSettings: jest.fn().mockResolvedValue(undefined),
    };
}

export type VodDetailsRouteStubs = ReturnType<
    typeof createVodDetailsRouteStubs
>;

/** Back to the state a fresh `beforeEach` expects. */
export function resetVodDetailsRouteStubs(stubs: VodDetailsRouteStubs): void {
    stubs.routeParams.next({ vodId: '650020', categoryId: '235' });
    stubs.selectedItem.set(null);
    stubs.isLoadingDetails.set(false);
    stubs.detailsError.set(null);
    stubs.isFavorite.set(false);
    stubs.currentPlaylist.set(null);
    stubs.vodStreams.set([]);
    stubs.vodCategories.set([]);
    stubs.downloadsAvailable.set(false);
    stubs.activeSession.set(null);
    stubs.selectedPlayer.set(VideoPlayer.Html5Player);
    stubs.updateSettings.mockClear().mockResolvedValue(undefined);

    for (const value of Object.values(stubs)) {
        if (jest.isMockFunction(value) && value !== stubs.updateSettings) {
            value.mockClear();
        }
    }

    stubs.isDownloaded.mockReturnValue(false);
    stubs.isDownloading.mockReturnValue(false);
    stubs.isPausedDownload.mockReturnValue(false);
    stubs.getDownloadedFilePath.mockReturnValue(undefined);
    stubs.isEmbeddedPlayer.mockReturnValue(false);
}

/**
 * Silences the route's own debug chatter without hiding anything else — a
 * genuine warning from the component under test must still reach the console.
 */
export function silenceRouteLogging(): () => void {
    const consoleDebug = console.debug.bind(console);
    const consoleWarn = console.warn.bind(console);
    const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation((...args: unknown[]) => {
            if (
                args[0] === '[VodDetailsRoute]' ||
                args[0] === '[VodDetailsPlayback]'
            ) {
                return;
            }

            consoleDebug(...args);
        });
    const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation((...args: unknown[]) => {
            if (
                args[0] === '[VodDetailsRoute]' &&
                args[1] === 'Deferring VOD details init: playlist not ready'
            ) {
                return;
            }

            consoleWarn(...args);
        });

    return () => {
        debugSpy.mockRestore();
        warnSpy.mockRestore();
    };
}

export async function configureVodDetailsRouteTestBed(
    stubs: VodDetailsRouteStubs
): Promise<void> {
    await TestBed.configureTestingModule({
        imports: [VodDetailsRouteComponent],
        providers: [
            {
                provide: ActivatedRoute,
                useValue: {
                    params: stubs.routeParams,
                    snapshot: {
                        params: { vodId: '650020', categoryId: '235' },
                    },
                },
            },
            {
                provide: TranslateService,
                useValue: {
                    instant: (key: string) => key,
                    get: (key: string) => of(key),
                    stream: (key: string) => of(key),
                    onLangChange: of(null),
                    onTranslationChange: of(null),
                    onDefaultLangChange: of(null),
                    currentLang: 'en',
                    defaultLang: 'en',
                },
            },
            {
                provide: XtreamStore,
                useValue: {
                    selectedItem: stubs.selectedItem,
                    isLoadingDetails: stubs.isLoadingDetails,
                    detailsError: stubs.detailsError,
                    isFavorite: stubs.isFavorite,
                    currentPlaylist: stubs.currentPlaylist,
                    vodStreams: stubs.vodStreams,
                    vodCategories: stubs.vodCategories,
                    fetchVodDetailsWithMetadata:
                        stubs.fetchVodDetailsWithMetadata,
                    checkFavoriteStatus: stubs.checkFavoriteStatus,
                    setSelectedItem: stubs.setSelectedItem,
                    toggleFavorite: stubs.toggleFavorite,
                    constructVodStreamUrl: stubs.constructVodStreamUrl,
                    addRecentItem: stubs.addRecentItem,
                    backfillContentMetadata: jest.fn(),
                    cancelDetailsRequest: stubs.cancelDetailsRequest,
                    vodStreamsPlaylistId: stubs.vodStreamsPlaylistId,
                    vodCategoriesPlaylistId: stubs.vodCategoriesPlaylistId,
                },
            },
            {
                provide: SettingsStore,
                useValue: {
                    theme: signal('dark'),
                    player: stubs.selectedPlayer,
                    updateSettings: stubs.updateSettings,
                },
            },
            {
                provide: DownloadsService,
                useValue: {
                    isAvailable: stubs.downloadsAvailable,
                    downloads: stubs.downloads,
                    isDownloaded: stubs.isDownloaded,
                    isDownloading: stubs.isDownloading,
                    isPaused: stubs.isPausedDownload,
                    resumeDownloadByContent: stubs.resumeDownloadByContent,
                    startDownload: stubs.startDownload,
                    getDownloadedFilePath: stubs.getDownloadedFilePath,
                    getDownloadByContent: jest.fn(),
                    getProgressPercent: jest.fn().mockReturnValue(0),
                    cancelDownload: jest.fn().mockResolvedValue({
                        success: true,
                    }),
                    revealFile: jest.fn().mockResolvedValue({ success: true }),
                    playDownload: stubs.playDownload,
                },
            },
            {
                provide: PORTAL_EXTERNAL_PLAYBACK,
                useValue: {
                    activeSession: stubs.activeSession,
                    closeSession: stubs.closeSession,
                },
            },
            {
                provide: PORTAL_PLAYBACK_POSITIONS,
                useValue: {
                    getPlaybackPosition: stubs.getPlaybackPosition,
                    savePlaybackPosition: stubs.savePlaybackPosition,
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
            { provide: MatSnackBar, useValue: { open: stubs.snackBarOpen } },
            { provide: Location, useValue: { back: stubs.locationBack } },
        ],
    }).compileComponents();
}

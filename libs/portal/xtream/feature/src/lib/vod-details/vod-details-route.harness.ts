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
import { of } from 'rxjs';
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
        downloads: signal([]),
        getPlaybackPosition: jest.fn().mockResolvedValue(null),
        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
        activeSession: signal<unknown>(null),
        closeSession: jest.fn(),
        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
        openResolvedPlayback: jest.fn(),
        snackBarOpen: jest.fn(),
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
    stubs.selectedItem.set(null);
    stubs.isLoadingDetails.set(false);
    stubs.detailsError.set(null);
    stubs.isFavorite.set(false);
    stubs.currentPlaylist.set(null);
    stubs.vodStreams.set([]);
    stubs.vodCategories.set([]);
    stubs.activeSession.set(null);
    stubs.selectedPlayer.set(VideoPlayer.Html5Player);
    stubs.updateSettings.mockClear().mockResolvedValue(undefined);

    for (const value of Object.values(stubs)) {
        if (jest.isMockFunction(value) && value !== stubs.updateSettings) {
            value.mockClear();
        }
    }
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
                    params: of({ vodId: '650020', categoryId: '235' }),
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
                    isAvailable: signal(false),
                    downloads: stubs.downloads,
                    isDownloaded: jest.fn().mockReturnValue(false),
                    isDownloading: jest.fn().mockReturnValue(false),
                    startDownload: jest.fn(),
                    getDownloadedFilePath: jest.fn(),
                    playDownload: jest.fn(),
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
                },
            },
            { provide: MatSnackBar, useValue: { open: stubs.snackBarOpen } },
            { provide: Location, useValue: { back: stubs.locationBack } },
        ],
    }).compileComponents();
}

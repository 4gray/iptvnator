import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Location } from '@angular/common';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import { MatSnackBar } from '@angular/material/snack-bar';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsRouteComponent } from './vod-details-route.component';

/**
 * What the page CLAIMS is playing.
 *
 * "Playing from ..." is a statement of fact about the stream on screen, and
 * discovery marks a source active long before one exists — so the line has to
 * be gated on playback rather than on selection.
 */
describe('VodDetailsRouteComponent — source caption', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    let consoleDebugSpy: jest.SpyInstance | undefined;
    let consoleWarnSpy: jest.SpyInstance | undefined;
    const selectedItem = signal<XtreamVodDetails | null>(null);
    const isLoadingDetails = signal(false);
    const detailsError = signal<string | null>(null);
    const isFavorite = signal(false);
    const currentPlaylist = signal<{
        id: string;
        userAgent?: string;
        referrer?: string;
        origin?: string;
    } | null>(null);
    const vodStreams = signal<Partial<XtreamVodStream>[]>([]);
    const vodCategories = signal<Partial<XtreamCategory>[]>([]);
    const fetchVodDetailsWithMetadata = jest.fn();
    const checkFavoriteStatus = jest.fn();
    const setSelectedItem = jest.fn();
    const toggleFavorite = jest.fn();
    const constructVodStreamUrl = jest
        .fn()
        .mockReturnValue('http://example.com/movie/650020.mp4');
    const addRecentItem = jest.fn();
    const downloads = signal([]);
    const getPlaybackPosition = jest.fn().mockResolvedValue(null);
    const activeSession = signal<unknown>(null);
    const closeSession = jest.fn();

    beforeEach(async () => {
        const consoleDebug = console.debug.bind(console);
        const consoleWarn = console.warn.bind(console);
        consoleDebugSpy = jest
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
        consoleWarnSpy = jest
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

        selectedItem.set(null);
        isLoadingDetails.set(false);
        detailsError.set(null);
        isFavorite.set(false);
        currentPlaylist.set(null);
        vodStreams.set([]);
        vodCategories.set([]);
        fetchVodDetailsWithMetadata.mockClear();
        checkFavoriteStatus.mockClear();
        setSelectedItem.mockClear();
        toggleFavorite.mockClear();
        constructVodStreamUrl.mockClear();
        addRecentItem.mockClear();
        getPlaybackPosition.mockClear();
        activeSession.set(null);
        closeSession.mockClear();

        await TestBed.configureTestingModule({
            imports: [VodDetailsRouteComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        params: of({
                            vodId: '650020',
                            categoryId: '235',
                        }),
                        snapshot: {
                            params: {
                                vodId: '650020',
                                categoryId: '235',
                            },
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
                        selectedItem,
                        isLoadingDetails,
                        detailsError,
                        isFavorite,
                        currentPlaylist,
                        vodStreams,
                        vodCategories,
                        fetchVodDetailsWithMetadata,
                        checkFavoriteStatus,
                        setSelectedItem,
                        toggleFavorite,
                        constructVodStreamUrl,
                        addRecentItem,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        theme: signal('dark'),
                    },
                },
                {
                    provide: DownloadsService,
                    useValue: {
                        isAvailable: signal(false),
                        downloads,
                        isDownloaded: jest.fn().mockReturnValue(false),
                        isDownloading: jest.fn().mockReturnValue(false),
                        startDownload: jest.fn(),
                        getDownloadedFilePath: jest.fn(),
                        playDownload: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession, closeSession },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition,
                        savePlaybackPosition: jest
                            .fn()
                            .mockResolvedValue(undefined),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: Location,
                    useValue: {
                        back: jest.fn(),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(VodDetailsRouteComponent);
    });

    afterEach(() => {
        consoleDebugSpy?.mockRestore();
        consoleWarnSpy?.mockRestore();
    });

    /**
     * Stand in for a discovered source list.
     *
     * The real one comes from a worker-backed discovery the route spec cannot
     * reach, and every test here only needs "this row is the active one".
     */
    function withActiveSource(playlistId: string, contentId: number): void {
        Object.defineProperty(
            fixture.componentInstance.multiSource,
            'sources',
            {
                configurable: true,
                value: () => [
                    {
                        id: `${playlistId}:xtream:${contentId}`,
                        playlistId,
                        playlistName: 'Portal One',
                        portalType: 'xtream',
                        contentId,
                        rawTitle: 'Example',
                        matchConfidence: 'exact',
                        year: null,
                        isActive: true,
                        isPinned: false,
                        isTried: true,
                        probe: { status: 'idle' },
                    },
                ],
            }
        );
    }

    it('claims to be playing only while something is', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        withActiveSource('playlist-1', 650020);

        // Discovery marks a source active as soon as the page opens, so the
        // caption would otherwise say "Playing from ..." before Play is
        // pressed — and again after the player is closed.
        expect(component.activeSourceCaption()).toBeNull();

        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Example',
        });
        expect(component.activeSourceCaption()).not.toBeNull();

        playback.inlinePlayback.set(null);
        expect(component.activeSourceCaption()).toBeNull();
    });

    it('stops claiming playback once the error screen is up', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        withActiveSource('playlist-1', 650020);
        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Example',
        });
        expect(component.activeSourceCaption()).not.toBeNull();

        // The host stays mounted through a failure, so the caption would go on
        // naming a source while the diagnostic says it could not be played.
        await component.onPlaybackFailed();
        expect(component.activeSourceCaption()).toBeNull();

        // And comes back when the engine produces time again.
        component.handleInlineTimeUpdate({ currentTime: 3, duration: 90 });
        expect(component.activeSourceCaption()).not.toBeNull();
    });
});

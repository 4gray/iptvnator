import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Location } from '@angular/common';
import { ContentHeroComponent } from '@iptvnator/ui/components';
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
 * What the primary button and the resume point do, as opposed to what the
 * page renders. Split from the rendering spec to keep both inside the
 * repository's file-size rule.
 */
describe('VodDetailsRouteComponent — playback actions', () => {
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

    it('claims to be playing only while something is', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        Object.defineProperty(component.multiSource, 'sources', {
            configurable: true,
            value: () => [
                {
                    id: 'playlist-1:xtream:650020',
                    playlistId: 'playlist-1',
                    playlistName: 'Portal One',
                    portalType: 'xtream',
                    contentId: 650020,
                    rawTitle: 'Example',
                    matchConfidence: 'exact',
                    year: null,
                    isActive: true,
                    isPinned: false,
                    isTried: true,
                    probe: { status: 'idle' },
                },
            ],
        });

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

    it('owns an external session for a copy in its own playlist', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );

        // A pinned copy can now live in the route's OWN playlist. Comparing
        // playlists alone would call this "the route source", and the page
        // would disown the session it started for it.
        Object.defineProperty(component.multiSource, 'sources', {
            configurable: true,
            value: () => [
                {
                    id: 'playlist-1:xtream:4242',
                    playlistId: 'playlist-1',
                    playlistName: 'Portal One',
                    portalType: 'xtream',
                    contentId: 4242,
                    rawTitle: 'Example',
                    matchConfidence: 'exact',
                    year: null,
                    isActive: true,
                    isPinned: true,
                    isTried: true,
                    probe: { status: 'idle' },
                },
            ],
        });
        activeSession.set({
            player: 'mpv',
            status: 'playing',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 4242,
                contentType: 'vod',
            },
        });

        expect(playback.matchedExternalPlayback()).not.toBeNull();
        expect(component.isExternalStopAction()).toBe(true);
    });

    it('drops the carried position when Restart starts from the beginning', () => {
        const component = fixture.componentInstance;
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        component.playVod({} as XtreamVodDetails);

        // The controller still holds whatever this page was seeded with, and
        // a failure before the first timeupdate would resolve the next source
        // back at it instead of honouring the restart.
        expect(reported).toHaveBeenCalledWith(0);
    });

    it('stops the external player when the button says Stop', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        activeSession.set({
            player: 'mpv',
            status: 'playing',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 650020,
                contentType: 'vod',
            },
        });

        const component = fixture.componentInstance;
        const playPinned = jest.spyOn(
            component.multiSource,
            'playPinnedSource'
        );
        expect(component.isExternalStopAction()).toBe(true);

        await component.onPrimaryAction({} as XtreamVodDetails);

        // Consulting the pin first would launch a second player while the
        // first keeps running — the control doing the opposite of its label.
        expect(playPinned).not.toHaveBeenCalled();
        expect(closeSession).toHaveBeenCalled();
    });

    it('follows external playback progress, which has no timeupdate', () => {
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        // MPV/VLC report only through the polled position, so this IS their
        // live timecode. Treating it as a one-shot seed would freeze the
        // resume point at the start and rewind a later source switch by
        // however long the user had been watching.
        playback.vodPlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 650020,
            contentType: 'vod',
            positionSeconds: 120,
            durationSeconds: 7744,
        });
        fixture.detectChanges();
        expect(reported).toHaveBeenLastCalledWith(120);

        playback.vodPlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 650020,
            contentType: 'vod',
            positionSeconds: 3600,
            durationSeconds: 7744,
        });
        fixture.detectChanges();
        expect(reported).toHaveBeenLastCalledWith(3600);
    });

    it('holds the resume point until the engine has seeked to it', () => {
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie/650020.mp4',
            title: 'City of McFarland',
            startTime: 2538,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 650020,
                contentType: 'vod',
            },
        });
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        // A resuming engine emits timeupdates at ~0 on its way to 2538. That
        // is not where the film is, and multi-source must not switch or fail
        // over back to the beginning because of it.
        component.handleInlineTimeUpdate({ currentTime: 0.2, duration: 7744 });
        expect(reported).toHaveBeenLastCalledWith(2538);

        component.handleInlineTimeUpdate({ currentTime: 2540, duration: 7744 });
        expect(reported).toHaveBeenLastCalledWith(2540);

        // One-shot latch, not a filter: a deliberate seek backwards counts.
        component.handleInlineTimeUpdate({ currentTime: 12, duration: 7744 });
        expect(reported).toHaveBeenLastCalledWith(12);
    });
});

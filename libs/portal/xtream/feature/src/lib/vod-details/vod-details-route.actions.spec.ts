import { Location } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    CrossPortalSimilarService,
    type DownloadItem,
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    SettingsStore,
} from '@iptvnator/services';
import {
    PlaybackPositionData,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { NEVER, of } from 'rxjs';
import { VodDetailsRouteComponent } from './vod-details-route.component';

@Component({
    selector: 'app-portal-inline-player',
    standalone: true,
    template: '<div data-testid="inline-vod-player"></div>',
})
class StubPortalInlinePlayerComponent {
    readonly playback = input<unknown>(null);
    // Multi-source wiring: the real player takes these, so the stub has to
    // accept them or the template binding fails to compile.
    readonly alternativeSources = input<unknown>([]);
    readonly allSources = input<unknown>([]);
    readonly sourcesMatchKind = input<unknown>(null);
    readonly sourcesAutoFailoverEnabled = input(false);
    readonly sourcesAutoFailoverSupported = input(true);
    readonly sourcesPlaybackLive = input(false);
    readonly sourcesAutoFailoverToggled = output<boolean>();
    readonly alternativeSourceRequested = output<string>();
    readonly sourcePinRequested = output<string>();
    readonly sourceCheckRequested = output<string>();
    readonly playbackFailed = output<unknown>();
    readonly timeUpdate = output<unknown>();
    readonly closed = output<void>();
    readonly backClicked = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<unknown>();
}
type SparseVodItem = XtreamVodDetails & {
    readonly container_extension: string;
    readonly name: string;
    readonly stream_icon: string;
    readonly stream_id: number;
};
describe('VodDetailsRouteComponent fallback actions', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    const selectedItem = signal<XtreamVodDetails | null>(null);
    const downloadsAvailable = signal(false);
    const isFavorite = signal(false);
    const downloads = signal<DownloadItem[]>([]);
    const activeSession = signal<unknown>(null);
    const currentPlaylist = signal({
        id: 'playlist-1',
        userAgent: 'IPTVnator',
        referrer: 'https://referrer.example',
        origin: 'https://origin.example',
    });
    const vodStreams = signal<Partial<XtreamVodStream>[]>([]);
    const vodCategories = signal<Partial<XtreamCategory>[]>([]);
    const vodStreamsPlaylistId = signal<string | null>('playlist-1');
    const vodCategoriesPlaylistId = signal<string | null>('playlist-1');
    const constructVodStreamUrl = jest
        .fn()
        .mockReturnValue('http://example.com/movie/650020.mp4');
    const isEmbeddedPlayer = jest.fn().mockReturnValue(true);
    const openResolvedPlayback = jest.fn();
    const startDownload = jest.fn().mockResolvedValue(undefined);
    const isDownloaded = jest.fn().mockReturnValue(false);
    const getDownloadedFilePath = jest.fn();
    const playDownload = jest.fn().mockResolvedValue(undefined);
    const toggleFavorite = jest.fn();
    const sparseItem = (): SparseVodItem => ({
        info: [],
        stream_id: 650020,
        container_extension: 'mp4',
        name: 'Catalog movie',
        stream_icon: 'https://example.com/catalog-poster.jpg',
    });
    const richItem = (): XtreamVodDetails =>
        ({
            info: {
                name: 'Metadata movie',
                description: 'A populated description',
                movie_image: 'https://example.com/metadata-poster.jpg',
                releasedate: '2025-01-02',
            },
            movie_data: {
                stream_id: 650020,
                name: 'Metadata movie',
                container_extension: 'mp4',
            },
        }) as XtreamVodDetails;
    const unplayableRichItem = (): XtreamVodDetails =>
        ({
            ...richItem(),
            movie_data: {
                stream_id: 650020,
                name: 'Metadata movie',
                container_extension: '',
            },
        }) as XtreamVodDetails;
    beforeEach(async () => {
        selectedItem.set(null);
        downloads.set([]);
        downloadsAvailable.set(false);
        activeSession.set(null);
        isFavorite.set(false);
        currentPlaylist.set({
            id: 'playlist-1',
            userAgent: 'IPTVnator',
            referrer: 'https://referrer.example',
            origin: 'https://origin.example',
        });
        vodStreams.set([]);
        vodCategories.set([]);
        vodStreamsPlaylistId.set('playlist-1');
        vodCategoriesPlaylistId.set('playlist-1');
        constructVodStreamUrl.mockClear();
        isEmbeddedPlayer.mockReset().mockReturnValue(true);
        openResolvedPlayback.mockClear();
        startDownload.mockClear();
        isDownloaded.mockReset().mockImplementation(
            (
                xtreamId: number,
                playlistId: string,
                contentType: 'vod' | 'episode'
            ) => {
                const item = downloads().find(
                    (download) =>
                        download.xtreamId === xtreamId &&
                        download.playlistId === playlistId &&
                        download.contentType === contentType
                );
                return (
                    item?.status === 'completed' &&
                    !!item.filePath &&
                    item.fileAvailability !== 'missing'
                );
            }
        );
        getDownloadedFilePath.mockReset().mockImplementation(
            (
                xtreamId: number,
                playlistId: string,
                contentType: 'vod' | 'episode'
            ) => {
                const item = downloads().find(
                    (download) =>
                        download.xtreamId === xtreamId &&
                        download.playlistId === playlistId &&
                        download.contentType === contentType
                );
                return item?.status === 'completed' &&
                    item.fileAvailability !== 'missing'
                    ? item.filePath
                    : undefined;
            }
        );
        playDownload.mockClear();
        toggleFavorite.mockClear();
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
                    provide: Router,
                    useValue: { navigate: jest.fn() },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: NEVER,
                        onTranslationChange: NEVER,
                        onDefaultLangChange: NEVER,
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        selectedItem,
                        isLoadingDetails: signal(false),
                        detailsError: signal(null),
                        isFavorite,
                        currentPlaylist,
                        vodStreams,
                        vodCategories,
                        vodStreamsPlaylistId,
                        vodCategoriesPlaylistId,
                        fetchVodDetailsWithMetadata: jest.fn(),
                        cancelDetailsRequest: jest.fn(),
                        checkFavoriteStatus: jest.fn(),
                        setSelectedItem: jest.fn(),
                        toggleFavorite,
                        constructVodStreamUrl,
                        addRecentItem: jest.fn(),
                    },
                },
                {
                    provide: DownloadsService,
                    useValue: {
                        isAvailable: downloadsAvailable,
                        downloads,
                        isDownloaded,
                        isDownloading: jest.fn().mockReturnValue(false),
                        isPaused: jest.fn().mockReturnValue(false),
                        resumeDownloadByContent: jest.fn(),
                        startDownload,
                        getDownloadedFilePath,
                        playDownload,
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer,
                        openResolvedPlayback,
                        openExternalPlayback: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession,
                        closeSession: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition: jest.fn().mockResolvedValue(null),
                        savePlaybackPosition: jest.fn(),
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: jest.fn(),
                    },
                },
                {
                    provide: CrossPortalSimilarService,
                    useValue: {
                        isAvailable: false,
                        buildLink: jest.fn(),
                        matchRecommendations: jest.fn(),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: { theme: signal('dark') },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: Location, useValue: { back: jest.fn() } },
            ],
        })
            .overrideComponent(VodDetailsRouteComponent, {
                remove: { imports: [PortalInlinePlayerComponent] },
                add: { imports: [StubPortalInlinePlayerComponent] },
            })
            .compileComponents();
        fixture = TestBed.createComponent(VodDetailsRouteComponent);
    });
    it('ignores catalog data owned by another playlist', () => {
        currentPlaylist.set({
            id: 'playlist-b',
            userAgent: 'IPTVnator',
            referrer: 'https://referrer.example',
            origin: 'https://origin.example',
        });
        vodStreamsPlaylistId.set('playlist-a');
        vodCategoriesPlaylistId.set('playlist-a');
        vodStreams.set([
            {
                name: 'Stale catalog title',
                stream_id: 650020,
                container_extension: 'mkv',
            },
        ]);
        vodCategories.set([
            {
                category_id: '235',
                category_name: 'Stale category',
            },
        ]);

        fixture.detectChanges();

        expect(fixture.componentInstance.selectedCatalogItem()).toBeNull();
        expect(fixture.componentInstance.selectedCategory()).toBeNull();
    });
    it('starts playable sparse VOD inline with catalog presentation', () => {
        const item = sparseItem();
        selectedItem.set(item);
        downloadsAvailable.set(true);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        expect(host.querySelector('button.play-btn')).not.toBeNull();
        expect(host.querySelector('button.favorite-btn')).not.toBeNull();
        expect(host.querySelector('button.download-btn')).not.toBeNull();
        host.querySelector<HTMLButtonElement>('button.play-btn')?.click();
        fixture.detectChanges();
        expect(constructVodStreamUrl).toHaveBeenCalledWith(item);
        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({
                streamUrl: 'http://example.com/movie/650020.mp4',
                title: 'Catalog movie',
                thumbnail: 'https://example.com/catalog-poster.jpg',
            })
        );
        expect(
            host.querySelector('app-portal-detail-shell')?.classList
        ).toContain('shell-host--watch');
    });
    it('reuses the sparse item for resume, favorite, and download', async () => {
        const item = sparseItem();
        selectedItem.set(item);
        downloadsAvailable.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        const storedPosition = {
            contentXtreamId: 650020,
            contentType: 'vod',
            playlistId: 'playlist-1',
            positionSeconds: 42,
            durationSeconds: 120,
        } satisfies PlaybackPositionData;
        // Both, as `loadPosition` does: the Resume button reads the ROUTE
        // copy's row, while `vodPlaybackPosition` follows whichever copy last
        // reported — multi-source can put those on different streams.
        fixture.componentInstance.vodPlaybackPosition.set(storedPosition);
        fixture.componentInstance.routePlaybackPosition.set(storedPosition);
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        host.querySelector<HTMLButtonElement>(
            'button.play-btn--resume'
        )?.click();
        fixture.detectChanges();
        host.querySelector<HTMLButtonElement>('button.favorite-btn')?.click();
        host.querySelector<HTMLButtonElement>('button.download-btn')?.click();
        await fixture.whenStable();

        expect(constructVodStreamUrl).toHaveBeenNthCalledWith(1, item);
        expect(constructVodStreamUrl).toHaveBeenNthCalledWith(2, item);
        expect(toggleFavorite).toHaveBeenCalledWith(
            '650020',
            'playlist-1',
            'movie',
            undefined
        );
        expect(startDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Catalog movie',
                posterUrl: 'https://example.com/catalog-poster.jpg',
                url: 'http://example.com/movie/650020.mp4',
            })
        );
        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        expect(inlinePlayer.playback()).toEqual(
            expect.objectContaining({ startTime: 42 })
        );
    });

    it('keeps external playback in the browse shell', () => {
        const item = sparseItem();
        selectedItem.set(item);
        isEmbeddedPlayer.mockReturnValue(false);
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        host.querySelector<HTMLButtonElement>('button.play-btn')?.click();
        fixture.detectChanges();

        expect(openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Catalog movie',
                thumbnail: 'https://example.com/catalog-poster.jpg',
            }),
            true
        );
        expect(
            fixture.debugElement.query(
                By.directive(StubPortalInlinePlayerComponent)
            )
        ).toBeNull();
        expect(
            host.querySelector('app-portal-detail-shell')?.classList
        ).not.toContain('shell-host--watch');
    });

    it('renders Offline and offline-first actions for sparse downloaded details', async () => {
        selectedItem.set(sparseItem());
        downloadsAvailable.set(true);
        isDownloaded.mockReturnValue(true);
        getDownloadedFilePath.mockReturnValue('/downloads/catalog-movie.mp4');

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const primary =
            host.querySelector<HTMLButtonElement>('button.play-btn');
        expect(host.textContent).toContain('DOWNLOADS.OFFLINE');
        expect(primary?.textContent).toContain('DOWNLOADS.PLAY_LOCAL');
        expect(
            Array.from(host.querySelectorAll('button.download-btn')).some(
                (button) =>
                    button.textContent?.includes(
                        'PORTALS.MULTI_SOURCE.PLAY_FROM_SOURCE'
                    )
            )
        ).toBe(true);

        primary?.click();
        await fixture.whenStable();

        expect(playDownload).toHaveBeenCalledWith(
            '/downloads/catalog-movie.mp4'
        );
        expect(constructVodStreamUrl).not.toHaveBeenCalled();
    });

    it('keeps a missing completed file on provider playback', async () => {
        selectedItem.set(sparseItem());
        downloadsAvailable.set(true);
        downloads.set([
            {
                contentType: 'vod',
                fileAvailability: 'missing',
                filePath: '/downloads/catalog-movie.mp4',
                id: 42,
                playlistId: 'playlist-1',
                status: 'completed',
                title: 'Catalog movie',
                url: 'https://example.test/catalog-movie.mp4',
                xtreamId: 650020,
            },
        ]);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const primary =
            host.querySelector<HTMLButtonElement>('button.play-btn');
        expect(host.textContent).not.toContain('DOWNLOADS.OFFLINE');
        expect(primary?.textContent).toContain('XTREAM.PLAY');

        primary?.click();
        await fixture.whenStable();

        expect(playDownload).not.toHaveBeenCalled();
        expect(constructVodStreamUrl).toHaveBeenCalled();
    });

    it('renders Offline in rich downloaded details', () => {
        selectedItem.set(richItem());
        downloadsAvailable.set(true);
        isDownloaded.mockReturnValue(true);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback"]')
        ).toBeNull();
        expect(host.textContent).toContain('DOWNLOADS.OFFLINE');
        expect(
            host.querySelector<HTMLButtonElement>('button.play-btn')
                ?.textContent
        ).toContain('DOWNLOADS.PLAY_LOCAL');
    });

    it('plays a rich downloaded movie locally without a usable provider source', async () => {
        selectedItem.set(unplayableRichItem());
        downloadsAvailable.set(true);
        isDownloaded.mockReturnValue(true);
        getDownloadedFilePath.mockReturnValue('/downloads/metadata-movie.mp4');

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        const primary =
            host.querySelector<HTMLButtonElement>('button.play-btn');
        expect(fixture.componentInstance.playableVodItem()).toBeNull();
        expect(host.textContent).toContain('DOWNLOADS.OFFLINE');
        expect(primary?.textContent).toContain('DOWNLOADS.PLAY_LOCAL');
        expect(host.textContent).not.toContain(
            'PORTALS.MULTI_SOURCE.PLAY_FROM_SOURCE'
        );

        primary?.click();
        await fixture.whenStable();

        expect(playDownload).toHaveBeenCalledWith(
            '/downloads/metadata-movie.mp4'
        );
        expect(constructVodStreamUrl).not.toHaveBeenCalled();
        expect(openResolvedPlayback).not.toHaveBeenCalled();
    });

    it('keeps pinned provider playback behind the downloaded secondary action', async () => {
        selectedItem.set(sparseItem());
        downloadsAvailable.set(true);
        isDownloaded.mockReturnValue(true);
        const playPinned = jest
            .spyOn(fixture.componentInstance.multiSource, 'playPinnedSource')
            .mockResolvedValue('played');

        fixture.detectChanges();

        const providerButton = Array.from(
            (
                fixture.nativeElement as HTMLElement
            ).querySelectorAll<HTMLButtonElement>('button')
        ).find((button) =>
            button.textContent?.includes(
                'PORTALS.MULTI_SOURCE.PLAY_FROM_SOURCE'
            )
        );
        providerButton?.click();
        await fixture.whenStable();

        expect(playPinned).toHaveBeenCalled();
        expect(playDownload).not.toHaveBeenCalled();
        expect(constructVodStreamUrl).not.toHaveBeenCalled();
    });

    it('hides Restart and provider playback while a downloaded movie is opening externally', async () => {
        selectedItem.set(sparseItem());
        downloadsAvailable.set(true);
        isDownloaded.mockReturnValue(true);
        activeSession.set({
            player: 'mpv',
            status: 'launching',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 650020,
                contentType: 'vod',
            },
        });
        const position = {
            contentXtreamId: 650020,
            contentType: 'vod',
            playlistId: 'playlist-1',
            positionSeconds: 42,
            durationSeconds: 120,
        } satisfies PlaybackPositionData;

        fixture.detectChanges();
        fixture.componentInstance.vodPlaybackPosition.set(position);
        fixture.componentInstance.routePlaybackPosition.set(position);
        fixture.detectChanges();
        await fixture.whenStable();

        const host = fixture.nativeElement as HTMLElement;
        const primary = host.querySelector<HTMLButtonElement>(
            'button.play-btn--resume'
        );
        expect(primary?.disabled).toBe(true);
        expect(primary?.textContent).toContain('Opening in MPV...');
        expect(
            Array.from(host.querySelectorAll('button')).some((button) =>
                button.textContent?.includes('XTREAM.RESTART')
            )
        ).toBe(false);
        expect(
            Array.from(host.querySelectorAll('button')).some((button) =>
                button.textContent?.includes(
                    'PORTALS.MULTI_SOURCE.PLAY_FROM_SOURCE'
                )
            )
        ).toBe(false);
    });
});

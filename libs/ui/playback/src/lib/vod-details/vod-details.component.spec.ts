import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import {
    TranslateModule,
    TranslatePipe,
    TranslateService,
} from '@ngx-translate/core';
import {
    CastCrewRowComponent,
    DetailActionButtonComponent,
    DetailActionsTemplateDirective,
    DetailCreditsComponent,
    DetailIconButtonComponent,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    MetaChipComponent,
    PortalDetailShellComponent,
    SimilarRailComponent,
    ViewInPortalActionComponent,
    VodMoreMenuComponent,
} from '@iptvnator/ui/components';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import {
    CrossPortalSimilarService,
    DownloadItem,
    DownloadsService,
    SettingsStore,
} from '@iptvnator/services';
import {
    ExternalPlayerSession,
    VideoPlayer,
    VodDetailsItem,
    createStalkerVodItem,
} from '@iptvnator/shared/interfaces';
import type { VodDetailsComponent as VodDetailsComponentInstance } from './vod-details.component';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

/**
 * Stand-in for the inline player. The real one imports
 * `WebPlayerViewComponent`, which drags ArtPlayer, video.js and the
 * embedded-MPV bridge into this suite and instantiates that whole tree on
 * every `createComponent`. These specs only assert what the host *hands* the
 * player, so mirroring the selector and the template's bindings is enough —
 * and it keeps the per-test budget clear of Jest's timeout on slower CI
 * hardware.
 */
@Component({
    selector: 'app-portal-inline-player',
    template: '<div data-test-id="stub-portal-inline-player"></div>',
})
class StubPortalInlinePlayerComponent {
    readonly playbackSessionKey = input<string>('');
    readonly playback = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly closed = output<void>();
    readonly backClicked = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<unknown>();
}

const STALKER_VOD: VodDetailsItem = createStalkerVodItem(
    {
        id: '42',
        cmd: '/media/file_42.mpg',
        info: {
            name: 'Catalog Movie',
            movie_image: '',
            description: 'A movie from a Stalker portal',
            actors: '',
            director: '',
            releasedate: '2026-01-02',
            genre: 'Drama',
            rating_imdb: '',
            rating_kinopoisk: '',
        },
    },
    'stalker-1'
);

const MATCHING_MPV_SESSION: ExternalPlayerSession = {
    id: 'mpv-session-1',
    player: 'mpv',
    status: 'playing',
    title: 'Catalog Movie',
    streamUrl: 'https://portal.example/movie.mp4',
    contentInfo: {
        playlistId: 'stalker-1',
        contentXtreamId: 42,
        contentType: 'vod',
    },
    startedAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:01:00.000Z',
    canClose: true,
};

const MATCHING_LAUNCHING_MPV_SESSION: ExternalPlayerSession = {
    ...MATCHING_MPV_SESSION,
    status: 'launching',
};

describe('VodDetailsComponent offline playback', () => {
    let VodDetailsComponent: typeof import('./vod-details.component').VodDetailsComponent;
    let fixture: ComponentFixture<VodDetailsComponentInstance>;
    let downloads: ReturnType<typeof signal<DownloadItem[]>>;
    let playDownload: jest.Mock;
    let closeSession: jest.Mock;
    let playClicked: jest.Mock;
    let resumeClicked: jest.Mock;

    const matchingDownload = (
        xtreamId: number,
        playlistId: string,
        contentType: 'vod' | 'episode'
    ) =>
        downloads().find(
            (download) =>
                download.xtreamId === xtreamId &&
                download.playlistId === playlistId &&
                download.contentType === contentType
        );

    const buttonText = (button: HTMLButtonElement): string =>
        button.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    const byTestId = (testId: string): HTMLButtonElement | null =>
        fixture.nativeElement.querySelector(
            `[data-testid="${testId}"]`
        ) as HTMLButtonElement | null;

    const primaryButton = (): HTMLButtonElement => {
        const button = byTestId('vod-primary-action');
        expect(button).not.toBeNull();
        return button as HTMLButtonElement;
    };

    const providerPlayButton = (): HTMLButtonElement | null =>
        byTestId('vod-play-provider');

    /** Opens the "…" menu and returns its "Start over" row, if offered. */
    const openStartOver = async (): Promise<HTMLButtonElement | null> => {
        const trigger = byTestId('vod-more-menu');
        expect(trigger).not.toBeNull();
        trigger?.click();
        fixture.detectChanges();
        await fixture.whenStable();
        return TestBed.inject(OverlayContainer)
            .getContainerElement()
            .querySelector<HTMLButtonElement>(
                '[data-test-id="vod-menu-start-over"]'
            );
    };

    const closeMenu = async (): Promise<void> => {
        document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
        fixture.detectChanges();
        await fixture.whenStable();
    };

    const render = async ({
        playbackPosition = null,
        externalPlayback = null,
        providerOnly = false,
        isWatched = false,
    }: {
        playbackPosition?: number | null;
        externalPlayback?: ExternalPlayerSession | null;
        providerOnly?: boolean;
        isWatched?: boolean;
    } = {}) => {
        fixture = TestBed.createComponent(VodDetailsComponent);
        fixture.componentRef.setInput('item', STALKER_VOD);
        fixture.componentRef.setInput(
            'playbackSessionKey',
            'stalker-host-owned-key'
        );
        fixture.componentRef.setInput('playbackPosition', playbackPosition);
        fixture.componentRef.setInput('externalPlayback', externalPlayback);
        fixture.componentRef.setInput('providerOnly', providerOnly);
        fixture.componentRef.setInput('isWatched', isWatched);
        playClicked = jest.fn();
        resumeClicked = jest.fn();
        fixture.componentInstance.playClicked.subscribe(playClicked);
        fixture.componentInstance.resumeClicked.subscribe(resumeClicked);
        await fixture.whenStable();
    };

    it('passes the host-owned session key unchanged to inline playback', async () => {
        await render();
        fixture.componentRef.setInput('inlinePlayback', {
            streamUrl: 'https://portal.example/movie.mp4',
            title: 'Catalog Movie',
        });
        fixture.detectChanges();

        const inlinePlayer = fixture.debugElement.query(
            By.css('app-portal-inline-player')
        ).componentInstance as {
            playbackSessionKey(): string;
        };
        expect(inlinePlayer.playbackSessionKey()).toBe(
            'stalker-host-owned-key'
        );
    });

    const completeDownload = (
        fileAvailability: DownloadItem['fileAvailability'] = 'available'
    ) => {
        downloads.set([
            {
                id: 7,
                playlistId: 'stalker-1',
                xtreamId: 42,
                contentType: 'vod',
                title: 'Catalog Movie',
                url: 'https://portal.example/movie.mp4',
                filePath: '/downloads/movie.mp4',
                fileAvailability,
                status: 'completed',
            },
        ]);
    };

    beforeAll(async () => {
        ({ VodDetailsComponent } = await import('./vod-details.component'));
    });

    beforeEach(async () => {
        downloads = signal<DownloadItem[]>([]);
        playDownload = jest.fn().mockResolvedValue({ success: true });
        closeSession = jest.fn().mockResolvedValue(undefined);

        await TestBed.configureTestingModule({
            imports: [VodDetailsComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: {
                        downloads,
                        isAvailable: signal(true),
                        isDownloaded: jest.fn(
                            (
                                xtreamId: number,
                                playlistId: string,
                                contentType: 'vod' | 'episode'
                            ) =>
                                matchingDownload(
                                    xtreamId,
                                    playlistId,
                                    contentType
                                )?.status === 'completed' &&
                                matchingDownload(
                                    xtreamId,
                                    playlistId,
                                    contentType
                                )?.fileAvailability !== 'missing'
                        ),
                        isDownloading: jest.fn(() => false),
                        isPaused: jest.fn(() => false),
                        getDownloadedFilePath: jest.fn(
                            (
                                xtreamId: number,
                                playlistId: string,
                                contentType: 'vod' | 'episode'
                            ) => {
                                const item = matchingDownload(
                                    xtreamId,
                                    playlistId,
                                    contentType
                                );
                                return item?.status === 'completed' &&
                                    item.fileAvailability !== 'missing'
                                    ? item.filePath
                                    : undefined;
                            }
                        ),
                        playDownload,
                        resumeDownloadByContent: jest.fn(),
                    },
                },
                {
                    provide: CrossPortalSimilarService,
                    useValue: {
                        isAvailable: false,
                        matchRecommendations: jest.fn().mockResolvedValue([]),
                        buildLink: jest.fn(),
                        visible: <T>(items: T[]) => items,
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                        visibleSession: signal(null),
                        dismissActiveSession: jest.fn(),
                        closeSession,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.Html5Player) },
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(VodDetailsComponent, {
                // Same import list the component declares, with the inline
                // player swapped for the stub above.
                set: {
                    imports: [
                        CastCrewRowComponent,
                        DetailActionButtonComponent,
                        DetailActionsTemplateDirective,
                        DetailCreditsComponent,
                        DetailIconButtonComponent,
                        DetailMetaTemplateDirective,
                        DetailTagsTemplateDirective,
                        MetaChipComponent,
                        PortalDetailShellComponent,
                        SimilarRailComponent,
                        ViewInPortalActionComponent,
                        VodMoreMenuComponent,
                        StubPortalInlinePlayerComponent,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            XTREAM: {
                PLAY: 'Play',
                RESUME: 'Resume',
                RESTART: 'Restart',
                MARK_WATCHED: 'Mark as Watched',
                MARK_UNWATCHED: 'Mark as Unwatched',
            },
            WORKSPACE: { DASHBOARD: { HERO_CONTINUE: 'Continue' } },
            PORTALS: {
                ADD_TO_FAVORITES: 'Add to favorites',
                REMOVE_FROM_FAVORITES: 'Remove from favorites',
                MULTI_SOURCE: {
                    PLAY_FROM_SOURCE: 'Play from this source',
                },
            },
            DOWNLOADS: {
                DOWNLOAD: 'Download',
                PLAY_LOCAL: 'Play Local',
                RESUME: 'Resume download',
                OFFLINE: 'Offline',
                STATUS: {
                    DOWNLOADING: 'Downloading',
                },
            },
        });
        translate.use('en');
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('renders Offline and plays a completed download from the primary action', async () => {
        completeDownload();
        await render();

        expect(fixture.nativeElement.textContent).toContain('Offline');
        expect(buttonText(primaryButton())).toContain('Play Local');

        primaryButton().click();
        await fixture.whenStable();

        expect(playDownload).toHaveBeenCalledWith('/downloads/movie.mp4');
        expect(playClicked).not.toHaveBeenCalled();
        expect(resumeClicked).not.toHaveBeenCalled();
    });

    it('keeps a missing completed file on provider playback', async () => {
        completeDownload('missing');
        await render();

        expect(fixture.nativeElement.textContent).not.toContain('Offline');
        expect(buttonText(primaryButton())).toContain('Play');

        primaryButton().click();
        await fixture.whenStable();

        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(playDownload).not.toHaveBeenCalled();
    });

    it('plays the provider source from the downloaded secondary action', async () => {
        completeDownload();
        await render();

        expect(providerPlayButton()?.getAttribute('aria-label')).toBe(
            'Play from this source'
        );
        providerPlayButton()?.click();
        await fixture.whenStable();

        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(resumeClicked).not.toHaveBeenCalled();
        expect(playDownload).not.toHaveBeenCalled();
    });

    it('holds the downloaded provider action while a start is pending', async () => {
        completeDownload();
        await render();
        expect(providerPlayButton()?.disabled).toBe(false);

        // Same window as the primary action: a second start could not cancel
        // a launch already inside the player IPC.
        fixture.componentRef.setInput('playbackStartPending', true);
        fixture.detectChanges();
        expect(providerPlayButton()?.disabled).toBe(true);

        providerPlayButton()?.click();
        await fixture.whenStable();
        expect(playClicked).not.toHaveBeenCalled();
        expect(resumeClicked).not.toHaveBeenCalled();
    });

    it('resumes the provider source from the downloaded secondary action', async () => {
        completeDownload();
        await render({ playbackPosition: 83 });

        providerPlayButton()?.click();
        await fixture.whenStable();

        expect(resumeClicked).toHaveBeenCalledWith({
            item: STALKER_VOD,
            positionSeconds: 83,
        });
        expect(playClicked).not.toHaveBeenCalled();
        expect(playDownload).not.toHaveBeenCalled();
        // Start over lives in the "…" menu and stays there for a download.
        expect(await openStartOver()).not.toBeNull();
        await closeMenu();
    });

    it('keeps Stop MPV ahead of local and provider playback', async () => {
        completeDownload();
        await render({ externalPlayback: MATCHING_MPV_SESSION });

        expect(buttonText(primaryButton())).toContain('Stop MPV');
        expect(providerPlayButton()).toBeNull();

        primaryButton().click();
        await fixture.whenStable();

        expect(closeSession).toHaveBeenCalledWith(MATCHING_MPV_SESSION);
        expect(playDownload).not.toHaveBeenCalled();
        expect(playClicked).not.toHaveBeenCalled();
        expect(resumeClicked).not.toHaveBeenCalled();
    });

    it('keeps an opening MPV session ahead of every downloaded action', async () => {
        completeDownload();
        await render({
            playbackPosition: 83,
            externalPlayback: MATCHING_LAUNCHING_MPV_SESSION,
        });

        expect(buttonText(primaryButton())).toContain('Opening in MPV...');
        expect(primaryButton().disabled).toBe(true);
        expect(providerPlayButton()).toBeNull();
        expect(playDownload).not.toHaveBeenCalled();
        expect(playClicked).not.toHaveBeenCalled();
        expect(resumeClicked).not.toHaveBeenCalled();
    });

    it('hides Restart while an undownloaded MPV launch is pending', async () => {
        await render({
            playbackPosition: 83,
            externalPlayback: MATCHING_LAUNCHING_MPV_SESSION,
        });

        expect(buttonText(primaryButton())).toContain('Opening in MPV...');
        expect(primaryButton().disabled).toBe(true);
        expect(playClicked).not.toHaveBeenCalled();
        expect(resumeClicked).not.toHaveBeenCalled();
    });

    it('keeps normal provider Play as the undownloaded primary action', async () => {
        await render();

        expect(buttonText(primaryButton())).toContain('Play');
        expect(fixture.nativeElement.textContent).not.toContain('Offline');

        primaryButton().click();
        await fixture.whenStable();

        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(resumeClicked).not.toHaveBeenCalled();
        expect(playDownload).not.toHaveBeenCalled();
    });

    it('keeps provider Play and hides offline actions in provider-only mode', async () => {
        completeDownload();
        await render({ providerOnly: true });

        expect(fixture.nativeElement.textContent).not.toContain('Offline');
        expect(fixture.nativeElement.textContent).not.toContain('Play Local');
        expect(providerPlayButton()).toBeNull();
        expect(byTestId('vod-download-start')).toBeNull();
        expect(buttonText(primaryButton())).toContain('Play');

        primaryButton().click();
        await fixture.whenStable();

        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(playDownload).not.toHaveBeenCalled();
    });

    it('keeps provider Continue and Start over actions when undownloaded', async () => {
        await render({ playbackPosition: 83 });

        expect(buttonText(primaryButton())).toContain('Continue');
        expect(buttonText(primaryButton())).toContain('1:23');
        primaryButton().click();
        await fixture.whenStable();
        expect(resumeClicked).toHaveBeenCalledWith({
            item: STALKER_VOD,
            positionSeconds: 83,
        });

        const startOver = await openStartOver();
        expect(startOver).not.toBeNull();
        startOver?.click();
        await fixture.whenStable();
        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(playDownload).not.toHaveBeenCalled();
    });

    describe('manual watched toggle', () => {
        const watchedButton = (): HTMLButtonElement =>
            byTestId('vod-watched-toggle') as HTMLButtonElement;
        const watchedLabel = (): string =>
            watchedButton().getAttribute('aria-label') ?? '';

        it('offers Mark as Watched and emits the desired state', async () => {
            await render({ playbackPosition: 600 });
            const watchedToggled = jest.fn();
            fixture.componentInstance.watchedToggled.subscribe(watchedToggled);

            expect(watchedLabel()).toBe('Mark as Watched');
            expect(watchedButton().getAttribute('aria-pressed')).toBe('false');
            expect(buttonText(primaryButton())).toContain('Continue');

            watchedButton().click();

            expect(watchedToggled).toHaveBeenCalledWith({
                item: STALKER_VOD,
                watched: true,
            });
        });

        it('shows Play instead of Resume once the movie is watched', async () => {
            await render({ playbackPosition: 5400, isWatched: true });
            const watchedToggled = jest.fn();
            fixture.componentInstance.watchedToggled.subscribe(watchedToggled);

            expect(buttonText(primaryButton())).toContain('Play');
            expect(buttonText(primaryButton())).not.toContain('Continue');
            expect(watchedLabel()).toBe('Mark as Unwatched');
            expect(watchedButton().getAttribute('aria-pressed')).toBe('true');
            expect(watchedButton().classList).toContain('is-active');

            watchedButton().click();

            expect(watchedToggled).toHaveBeenCalledWith({
                item: STALKER_VOD,
                watched: false,
            });
        });

        it.each([
            [
                'the inline player is mounted',
                () =>
                    fixture.componentRef.setInput('inlinePlayback', {
                        streamUrl: 'https://portal.example/movie.mp4',
                        title: 'Catalog Movie',
                    }),
            ],
            [
                'an external session owns the movie',
                () =>
                    fixture.componentRef.setInput(
                        'externalPlayback',
                        MATCHING_MPV_SESSION
                    ),
            ],
            [
                'an external launch is pending',
                () =>
                    fixture.componentRef.setInput(
                        'externalPlayback',
                        MATCHING_LAUNCHING_MPV_SESSION
                    ),
            ],
            [
                'a watched write is in flight',
                () => fixture.componentRef.setInput('watchedToggleBusy', true),
            ],
            [
                'the stored position has not loaded yet',
                () =>
                    fixture.componentRef.setInput('watchedToggleReady', false),
            ],
            [
                'a playback start is still resolving',
                () =>
                    fixture.componentRef.setInput('playbackStartPending', true),
            ],
        ])('disables the toggle while %s', async (_label, arrange) => {
            await render();
            const watchedToggled = jest.fn();
            fixture.componentInstance.watchedToggled.subscribe(watchedToggled);
            arrange();
            fixture.detectChanges();

            expect(watchedButton().disabled).toBe(true);
            fixture.componentInstance.toggleWatched();
            expect(watchedToggled).not.toHaveBeenCalled();
        });
    });
});

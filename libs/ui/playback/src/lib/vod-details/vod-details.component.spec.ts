import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import {
    CrossPortalSimilarService,
    DownloadItem,
    DownloadsService,
} from '@iptvnator/services';
import {
    ExternalPlayerSession,
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

    const primaryButton = (): HTMLButtonElement => {
        const button = fixture.nativeElement.querySelector(
            '.action-buttons > .play-btn'
        ) as HTMLButtonElement | null;
        expect(button).not.toBeNull();
        return button as HTMLButtonElement;
    };

    const findButtonWithText = (text: string): HTMLButtonElement | undefined =>
        Array.from(
            fixture.nativeElement.querySelectorAll('.action-buttons button')
        ).find((candidate) =>
            buttonText(candidate as HTMLButtonElement).includes(text)
        ) as HTMLButtonElement | undefined;

    const buttonWithText = (text: string): HTMLButtonElement => {
        const button = findButtonWithText(text);
        expect(button).toBeDefined();
        return button as HTMLButtonElement;
    };

    const render = async ({
        playbackPosition = null,
        externalPlayback = null,
    }: {
        playbackPosition?: number | null;
        externalPlayback?: ExternalPlayerSession | null;
    } = {}) => {
        fixture = TestBed.createComponent(VodDetailsComponent);
        fixture.componentRef.setInput('item', STALKER_VOD);
        fixture.componentRef.setInput('playbackPosition', playbackPosition);
        fixture.componentRef.setInput('externalPlayback', externalPlayback);
        playClicked = jest.fn();
        resumeClicked = jest.fn();
        fixture.componentInstance.playClicked.subscribe(playClicked);
        fixture.componentInstance.resumeClicked.subscribe(resumeClicked);
        await fixture.whenStable();
    };

    const completeDownload = () => {
        downloads.set([
            {
                id: 7,
                playlistId: 'stalker-1',
                xtreamId: 42,
                contentType: 'vod',
                title: 'Catalog Movie',
                url: 'https://portal.example/movie.mp4',
                filePath: '/downloads/movie.mp4',
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
                                )?.status === 'completed'
                        ),
                        isDownloading: jest.fn(() => false),
                        isPaused: jest.fn(() => false),
                        getDownloadedFilePath: jest.fn(
                            (
                                xtreamId: number,
                                playlistId: string,
                                contentType: 'vod' | 'episode'
                            ) =>
                                matchingDownload(
                                    xtreamId,
                                    playlistId,
                                    contentType
                                )?.filePath
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
                    provide: Router,
                    useValue: {
                        navigate: jest.fn(),
                    },
                },
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            XTREAM: {
                PLAY: 'Play',
                RESUME: 'Resume',
                RESTART: 'Restart',
            },
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

    it('plays the provider source from the downloaded secondary action', async () => {
        completeDownload();
        await render();

        buttonWithText('Play from this source').click();
        await fixture.whenStable();

        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(resumeClicked).not.toHaveBeenCalled();
        expect(playDownload).not.toHaveBeenCalled();
    });

    it('resumes the provider source from the downloaded secondary action', async () => {
        completeDownload();
        await render({ playbackPosition: 83 });

        buttonWithText('Play from this source').click();
        await fixture.whenStable();

        expect(resumeClicked).toHaveBeenCalledWith({
            item: STALKER_VOD,
            positionSeconds: 83,
        });
        expect(playClicked).not.toHaveBeenCalled();
        expect(playDownload).not.toHaveBeenCalled();
        expect(
            Array.from(
                fixture.nativeElement.querySelectorAll('.action-buttons button')
            ).some((button) =>
                buttonText(button as HTMLButtonElement).includes('Restart')
            )
        ).toBe(false);
    });

    it('keeps Stop MPV ahead of local and provider playback', async () => {
        completeDownload();
        await render({ externalPlayback: MATCHING_MPV_SESSION });

        expect(buttonText(primaryButton())).toContain('Stop MPV');
        expect(findButtonWithText('Play from this source')).toBeUndefined();

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
        expect(findButtonWithText('Play from this source')).toBeUndefined();
        expect(findButtonWithText('Restart')).toBeUndefined();
        expect(playDownload).not.toHaveBeenCalled();
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

    it('keeps provider Resume and Restart actions when undownloaded', async () => {
        await render({ playbackPosition: 83 });

        expect(buttonText(primaryButton())).toContain('Resume 1:23');
        primaryButton().click();
        await fixture.whenStable();
        expect(resumeClicked).toHaveBeenCalledWith({
            item: STALKER_VOD,
            positionSeconds: 83,
        });

        buttonWithText('Restart').click();
        await fixture.whenStable();
        expect(playClicked).toHaveBeenCalledWith(STALKER_VOD);
        expect(playDownload).not.toHaveBeenCalled();
    });
});

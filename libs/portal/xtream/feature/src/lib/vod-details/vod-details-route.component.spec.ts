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
} from 'shared-interfaces';
import { DownloadsService, SettingsStore } from 'services';
import { MatSnackBar } from '@angular/material/snack-bar';
import { VodDetailsRouteComponent } from './vod-details-route.component';

describe('VodDetailsRouteComponent', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
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
    const constructVodStreamUrl = jest.fn().mockReturnValue(
        'http://example.com/movie/650020.mp4'
    );
    const addRecentItem = jest.fn();
    const downloads = signal([]);
    const getPlaybackPosition = jest.fn().mockResolvedValue(null);

    beforeEach(async () => {
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

        await TestBed.configureTestingModule({
            imports: [VodDetailsRouteComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
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
                    useValue: {
                        activeSession: signal(null),
                        closeSession: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition,
                        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
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

    it('renders an informational fallback without playback controls when Xtream returns empty metadata', () => {
        selectedItem.set({
            info: [],
        } as XtreamVodDetails);
        vodStreams.set([
            {
                name: 'Die Kühe sind Los! (2004) DE',
                stream_id: 650020,
                stream_icon: 'https://example.com/cows.jpg',
                added: '1720000000',
                category_id: '235',
                container_extension: 'mp4',
                rating: 6.1,
                rating_imdb: '6.1',
            },
        ]);
        vodCategories.set([
            {
                category_id: '235',
                category_name: 'DE | DISNEY',
            },
        ]);

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Die Kühe sind Los! (2004) DE');
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback"]')?.textContent
        ).toContain('XTREAM.DETAIL_FALLBACK.NOTE');
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback-status"]')
                ?.textContent
        ).toContain('XTREAM.DETAIL_FALLBACK.STATUS');
        expect(host.querySelector('button.play-btn')).toBeNull();
        expect(host.querySelector('button.favorite-btn')).toBeNull();
        expect(host.querySelector('button.download-btn')).toBeNull();
    });

    it('keeps the full Xtream detail view when usable metadata exists', () => {
        selectedItem.set({
            info: {
                kinopoisk_url: '',
                tmdb_id: 228203,
                name: 'City of McFarland (2015)',
                o_name: 'City of McFarland (2015)',
                cover_big: 'https://example.com/poster-big.jpg',
                movie_image: 'https://example.com/poster.jpg',
                releasedate: '2015-02-20',
                episode_run_time: 129,
                youtube_trailer: '',
                director: 'Niki Caro',
                actors: 'Kevin Costner',
                cast: 'Kevin Costner',
                description: 'A populated description',
                plot: 'A populated plot',
                age: '',
                mpaa_rating: '',
                rating_count_kinopoisk: 0,
                country: 'English',
                genre: 'Drama',
                backdrop_path: ['https://example.com/backdrop.jpg'],
                duration_secs: 7744,
                duration: '02:09:04',
                video: ['H.264'],
                audio: ['AAC'],
                bitrate: 6251,
                rating: 7.455,
                rating_imdb: '7.455',
                rating_kinopoisk: '7.455',
            },
            movie_data: {
                stream_id: 678140,
                name: 'City of McFarland (2015) DE',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        });

        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('City of McFarland (2015)');
        expect(host.querySelector('[data-testid="xtream-vod-fallback"]')).toBeNull();
        expect(host.querySelector('button.play-btn')).not.toBeNull();
    });
});

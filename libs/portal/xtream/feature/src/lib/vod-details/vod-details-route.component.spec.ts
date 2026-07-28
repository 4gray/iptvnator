import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsRouteComponent } from './vod-details-route.component';
import {
    configureVodDetailsRouteTestBed,
    createVodDetailsRouteStubs,
    resetVodDetailsRouteStubs,
    silenceRouteLogging,
} from './vod-details-route.harness';

describe('VodDetailsRouteComponent', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    let restoreLogging: (() => void) | undefined;
    const stubs = createVodDetailsRouteStubs();
    const {
        activeSession,
        addRecentItem,
        checkFavoriteStatus,
        closeSession,
        constructVodStreamUrl,
        currentPlaylist,
        detailsError,
        fetchVodDetailsWithMetadata,
        getPlaybackPosition,
        isFavorite,
        isLoadingDetails,
        selectedItem,
        setSelectedItem,
        toggleFavorite,
        vodCategories,
        vodStreams,
    } = stubs;

    beforeEach(async () => {
        restoreLogging = silenceRouteLogging();
        resetVodDetailsRouteStubs(stubs);
        await configureVodDetailsRouteTestBed(stubs);

        fixture = TestBed.createComponent(VodDetailsRouteComponent);
    });

    afterEach(() => {
        restoreLogging?.();
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
            host.querySelector('[data-testid="xtream-vod-fallback"]')
                ?.textContent
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
        expect(
            host.querySelector('[data-testid="xtream-vod-fallback"]')
        ).toBeNull();
        expect(host.querySelector('button.play-btn')).not.toBeNull();
    });

    it('renders usable metadata when backdrop_path is absent at runtime', () => {
        selectedItem.set({
            info: {
                name: 'Metadata Without Backdrop',
                description: 'A populated description',
                movie_image: 'https://example.com/poster.jpg',
            },
            movie_data: {
                stream_id: 678140,
                name: 'Metadata Without Backdrop',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        } as unknown as XtreamVodDetails);

        expect(() => fixture.detectChanges()).not.toThrow();

        const hero = fixture.debugElement.query(
            By.directive(ContentHeroComponent)
        ).componentInstance as ContentHeroComponent;
        expect(hero.backdropUrl()).toBeUndefined();
    });
});

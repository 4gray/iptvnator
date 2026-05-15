import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import { FavoritesButtonComponent } from './stalker-favorites-button.component';

describe('FavoritesButtonComponent', () => {
    let fixture: ComponentFixture<FavoritesButtonComponent>;
    let selectedContentType: ReturnType<typeof signal<'vod' | 'series'>>;
    let addToFavorites: jest.Mock;

    beforeEach(async () => {
        selectedContentType = signal<'vod' | 'series'>('series');
        addToFavorites = jest.fn((_item: unknown, onDone?: () => void) => {
            onDone?.();
        });

        await TestBed.configureTestingModule({
            imports: [
                FavoritesButtonComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        currentPlaylist: signal({ _id: 'stalker-1' }),
                        selectedContentType,
                        addToFavorites,
                        removeFromFavorites: jest.fn(),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPortalFavorites: jest.fn(() => of([])),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(FavoritesButtonComponent);
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('preserves VOD-series favorite payload shape from the VOD series view', () => {
        selectedContentType.set('vod');
        fixture.componentRef.setInput('itemId', '1507');
        fixture.componentRef.setInput('item', {
            id: '1507',
            cmd: '/media/file_1507.mpg',
            category_id: '2001',
            is_series: '1',
            info: {
                name: 'VOD Flagged Series',
                movie_image: 'poster.jpg',
            },
        });
        fixture.detectChanges();

        fixture.componentInstance.addToFavorites();

        expect(addToFavorites).toHaveBeenCalledWith(
            expect.objectContaining({
                id: '1507',
                category_id: '2001',
                is_series: true,
                title: 'VOD Flagged Series',
                cover: 'poster.jpg',
            }),
            expect.any(Function)
        );
        expect(addToFavorites.mock.calls[0][0]).not.toHaveProperty('series_id');
    });

    it('preserves embedded VOD series arrays in favorite payloads', () => {
        selectedContentType.set('vod');
        fixture.componentRef.setInput('itemId', '20001');
        fixture.componentRef.setInput('item', {
            id: '20001',
            cmd: '/media/file_20001.mpg',
            category_id: '2001',
            series: [1, 2],
            info: {
                name: 'Embedded Series',
                movie_image: 'embedded.jpg',
            },
        });
        fixture.detectChanges();

        fixture.componentInstance.addToFavorites();

        expect(addToFavorites).toHaveBeenCalledWith(
            expect.objectContaining({
                id: '20001',
                category_id: '2001',
                series: [1, 2],
                title: 'Embedded Series',
                cover: 'embedded.jpg',
            }),
            expect.any(Function)
        );
        expect(addToFavorites.mock.calls[0][0]).not.toHaveProperty('series_id');
    });

    it('writes regular Stalker series favorites with series_id', () => {
        selectedContentType.set('series');
        fixture.componentRef.setInput('itemId', '30001');
        fixture.componentRef.setInput('item', {
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                movie_image: 'series.jpg',
            },
        });
        fixture.detectChanges();

        fixture.componentInstance.addToFavorites();

        expect(addToFavorites).toHaveBeenCalledWith(
            expect.objectContaining({
                series_id: '30001',
                category_id: 'series',
                title: 'Regular Series',
                cover: 'series.jpg',
            }),
            expect.any(Function)
        );
    });
});

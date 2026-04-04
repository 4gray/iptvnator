import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { GlobalFavoritesWidgetComponent } from './global-favorites-widget.component';

describe('GlobalFavoritesWidgetComponent', () => {
    let fixture: ComponentFixture<GlobalFavoritesWidgetComponent>;
    const globalFavoritesLoading = signal(true);
    const globalFavoritesLoaded = signal(false);
    const globalFavoriteItems = signal<any[]>([]);

    const dataServiceMock = {
        globalFavoriteItems,
        globalFavoritesLoading,
        globalFavoritesLoaded,
        reloadGlobalFavorites: jest.fn().mockResolvedValue(undefined),
        isTypeInKind: jest.fn(
            (type: 'live' | 'movie' | 'series', kind: string) =>
                kind === 'all' ||
                (kind === 'channels' && type === 'live') ||
                (kind === 'vod' && type === 'movie') ||
                (kind === 'series' && type === 'series')
        ),
        getFavoriteItemProviderLabel: jest.fn(() => 'Xtream'),
        getFavoriteItemTypeLabel: jest.fn(() => 'Live TV'),
        getGlobalFavoriteLink: jest.fn(() => ['/workspace', 'global-favorites']),
        getGlobalFavoriteNavigationState: jest.fn(() => undefined),
        removeGlobalFavorite: jest.fn(),
    };

    beforeEach(async () => {
        globalFavoritesLoading.set(true);
        globalFavoritesLoaded.set(false);
        globalFavoriteItems.set([]);
        jest.clearAllMocks();

        await TestBed.configureTestingModule({
            imports: [
                GlobalFavoritesWidgetComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                provideRouter([]),
                {
                    provide: DashboardDataService,
                    useValue: dataServiceMock,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(GlobalFavoritesWidgetComponent);
        fixture.componentRef.setInput('widget', {
            id: 'global-favorites',
            type: 'global-favorites',
            enabled: true,
            order: 0,
            size: 'medium',
        } as any);
    });

    it('shows a spinner while global favorites are still loading', () => {
        fixture.detectChanges();

        expect(dataServiceMock.reloadGlobalFavorites).toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('mat-progress-spinner')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-state')
        ).toBeNull();
    });

    it('shows the empty state only after the initial load completes', () => {
        globalFavoritesLoading.set(false);
        globalFavoritesLoaded.set(true);

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('mat-progress-spinner')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-state')
        ).not.toBeNull();
    });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/ui';
import {
    PlaylistDeleteActionService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { DialogService } from '@iptvnator/ui/components';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import {
    DashboardDataService,
    DashboardSourceExpiryService,
    DashboardTrendingService,
    DashboardRecommendationsService,
    type DashboardFavoriteItem,
} from '@iptvnator/workspace/dashboard/data-access';
import { DashboardLiveEpgPresenter } from './dashboard-live-epg.presenter';
import { WorkspaceDashboardRailsComponent } from './workspace-dashboard-rails.component';

describe('dashboard favorite status translations', () => {
    it.each([
        'onLangChange',
        'onDefaultLangChange',
        'onTranslationChange',
    ] as const)(
        'refreshes both rails on %s without reloading favorites',
        (event) => {
            let language = 'en';
            const events = {
                onLangChange: new Subject(),
                onDefaultLangChange: new Subject(),
                onTranslationChange: new Subject(),
            };
            const saved: DashboardFavoriteItem = {
                id: 1,
                favorite_id: 1,
                source: 'xtream',
                playlist_id: 'p',
                category_id: '1',
                xtream_id: 7,
                type: 'movie',
                title: 'Saved',
                added_at: '2026-01-01',
                catalogStatus: 'missing',
            };
            TestBed.configureTestingModule({
                providers: [
                    ...[
                        MatDialog,
                        MatSnackBar,
                        Router,
                        Store,
                        DialogService,
                        PlaylistDeleteActionService,
                        PlaylistRefreshActionService,
                        WORKSPACE_SHELL_ACTIONS,
                        RuntimeCapabilitiesService,
                        SettingsStore,
                        DashboardTrendingService,
                        DashboardRecommendationsService,
                    ].map((provide) => ({ provide, useValue: {} })),
                    {
                        provide: TranslateService,
                        useValue: {
                            ...events,
                            instant: (key: string) => `${language}:${key}`,
                        },
                    },
                    {
                        provide: DashboardDataService,
                        useValue: {
                            globalFavoriteItems: signal([saved]),
                            globalFavoriteLiveItems: signal([
                                {
                                    ...saved,
                                    type: 'live',
                                    catalogStatus: 'unknown',
                                },
                            ]),
                            getGlobalFavoriteLink: () => [],
                            getGlobalFavoriteNavigationState: () => undefined,
                            reloadGlobalRecentItems: jest.fn(),
                            reloadGlobalFavorites: jest.fn(),
                        },
                    },
                    {
                        provide: DashboardLiveEpgPresenter,
                        useValue: { connect: jest.fn() },
                    },
                    {
                        provide: DashboardSourceExpiryService,
                        useValue: { facts: signal(new Map()) },
                    },
                ],
            });
            const component = TestBed.runInInjectionContext(
                () => new WorkspaceDashboardRailsComponent()
            );
            expect(component.liveFavoriteCards()[0].subtitle).toBe(
                'en:WORKSPACE.GLOBAL_FAVORITES.CATALOG_UNKNOWN'
            );
            expect(component.favoriteMoviesAndSeriesCards()[0].subtitle).toBe(
                'en:WORKSPACE.GLOBAL_FAVORITES.CATALOG_MISSING'
            );
            language = 'de';
            events[event].next({});
            expect(component.liveFavoriteCards()[0].subtitle).toBe(
                'de:WORKSPACE.GLOBAL_FAVORITES.CATALOG_UNKNOWN'
            );
            expect(component.favoriteMoviesAndSeriesCards()[0].subtitle).toBe(
                'de:WORKSPACE.GLOBAL_FAVORITES.CATALOG_MISSING'
            );
        }
    );
});

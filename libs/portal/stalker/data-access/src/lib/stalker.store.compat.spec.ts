import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerStore } from './stalker.store';

describe('StalkerStore API compatibility smoke', () => {
    let store: StalkerStore;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                StalkerStore,
                {
                    provide: DataService,
                    useValue: {
                        isElectron: false,
                        sendIpcEvent: jest.fn(),
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest.fn(),
                        makeAuthenticatedRequest: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        openPlayer: jest.fn(),
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        addPortalFavorite: jest.fn(() => of(undefined)),
                        removeFromPortalFavorites: jest.fn(() => of(undefined)),
                        addPortalRecentlyViewed: jest.fn(() => of(undefined)),
                        removeFromPortalRecentlyViewed: jest.fn(() =>
                            of(undefined)
                        ),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });

        store = TestBed.inject(StalkerStore);
    });

    it('exposes compatibility state signals', () => {
        const expectedSignals = [
            'selectedContentType',
            'selectedCategoryId',
            'selectedVodId',
            'selectedSerialId',
            'selectedItvId',
            'limit',
            'page',
            'searchPhrase',
            'currentPlaylist',
            'totalCount',
            'selectedItem',
            'vodCategories',
            'seriesCategories',
            'itvCategories',
            'hasMoreChannels',
            'itvChannels',
            'vodSeriesSeasons',
            'vodSeriesEpisodes',
            'selectedVodSeriesSeasonId',
        ];

        for (const signalName of expectedSignals) {
            expect(typeof store[signalName]).toBe('function');
        }
    });

    it('exposes compatibility computed selectors', () => {
        const expectedComputed = [
            'getTotalPages',
            'getPaginatedContent',
            'isPaginatedContentLoading',
            'isPaginatedContentFailed',
            'getSerialSeasonsResource',
            'isSerialSeasonsLoading',
            'getVodSeriesSeasonsResource',
            'isVodSeriesSeasonsLoading',
            'getCategoryResource',
            'isCategoryResourceLoading',
            'isCategoryResourceFailed',
            'getSelectedCategoryName',
        ];

        for (const computedName of expectedComputed) {
            expect(typeof store[computedName]).toBe('function');
        }
    });

    it('exposes compatibility methods and internal resources', () => {
        const expectedMethods = [
            'setSelectedContentType',
            'setSelectedCategory',
            'setSelectedSerialId',
            'setSelectedVodId',
            'setSelectedItvId',
            'setLimit',
            'setPage',
            'setCurrentPlaylist',
            'setSelectedItem',
            'clearSelectedItem',
            'setCategories',
            'resetCategories',
            'setItvChannels',
            'setSearchPhrase',
            'fetchVodSeriesEpisodes',
            'getSelectedCategory',
            'fetchLinkToPlay',
            'getExpireDate',
            'addToFavorites',
            'removeFromFavorites',
            'fetchMovieFileId',
            'resolveVodPlayback',
            'createLinkToPlayVod',
            'addToRecentlyViewed',
            'removeFromRecentlyViewed',
            'fetchChannelEpg',
            'makeStalkerRequest',
        ];

        for (const methodName of expectedMethods) {
            expect(typeof store[methodName]).toBe('function');
        }

        expect(store.getContentResource).toBeDefined();
        expect(typeof store.getContentResource.value).toBe('function');

        expect(store.serialSeasonsResource).toBeDefined();
        expect(typeof store.serialSeasonsResource.value).toBe('function');

        expect(store.vodSeriesSeasonsResource).toBeDefined();
        expect(typeof store.vodSeriesSeasonsResource.value).toBe('function');
    });
});

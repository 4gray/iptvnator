import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { convertToParamMap, ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import {
    CollectionScope,
    ScopeToggleService,
    UnifiedCollectionItem,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/util';
import {
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from 'm3u-state';
import { BehaviorSubject } from 'rxjs';
import { PlaylistMeta } from 'shared-interfaces';
import { UnifiedCollectionPageComponent } from './unified-collection-page.component';
import { UnifiedGridTabComponent } from './unified-grid-tab.component';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';

@Component({
    selector: 'app-unified-live-tab',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubUnifiedLiveTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly searchTerm = input('');
    readonly autoOpenItem = input<unknown>(null);

    readonly removeItem = output<UnifiedCollectionItem>();
    readonly reorderItems = output<UnifiedCollectionItem[]>();
    readonly itemPlayed = output<UnifiedCollectionItem>();
    readonly autoOpenHandled = output<void>();
}

@Component({
    selector: 'app-unified-grid-tab',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubUnifiedGridTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly contentType = input<'movie' | 'series'>('movie');
    readonly searchTerm = input('');

    readonly removeItem = output<UnifiedCollectionItem>();
}

describe('UnifiedCollectionPageComponent', () => {
    let fixture: ComponentFixture<UnifiedCollectionPageComponent>;
    let route: ActivatedRoute & {
        snapshot: {
            paramMap: ReturnType<typeof convertToParamMap>;
            queryParamMap: ReturnType<typeof convertToParamMap>;
            queryParams: Record<string, unknown>;
            params: Record<string, unknown>;
            data: Record<string, unknown>;
            parent: null;
        };
        paramMap: ReturnType<
            BehaviorSubject<ReturnType<typeof convertToParamMap>>['asObservable']
        >;
        queryParamMap: ReturnType<
            BehaviorSubject<ReturnType<typeof convertToParamMap>>['asObservable']
        >;
        pathFromRoot: ActivatedRoute[];
    };
    let routeParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let routeQueryParamMap$: BehaviorSubject<
        ReturnType<typeof convertToParamMap>
    >;
    let workspaceParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    const playlistsLoaded = signal(false);
    const playlists = signal<PlaylistMeta[]>([]);
    const favoritesData = {
        getFavorites: jest.fn().mockResolvedValue([]),
        removeFavorite: jest.fn(),
        reorder: jest.fn(),
    };
    const recentData = {
        getRecentItems: jest.fn().mockResolvedValue([]),
        removeRecentItem: jest.fn(),
        clearRecentItems: jest.fn(),
    };

    function toParamMapRecord(
        values: Record<string, unknown>
    ): Record<string, string> {
        return Object.fromEntries(
            Object.entries(values)
                .filter(([, value]) => value != null)
                .map(([key, value]) => [key, String(value)])
        );
    }

    function setRouteParams(params: Record<string, unknown>): void {
        const nextParamMap = convertToParamMap(toParamMapRecord(params));
        route.snapshot.params = params;
        route.snapshot.paramMap = nextParamMap;
        routeParamMap$.next(nextParamMap);
    }

    function setRouteQueryParams(queryParams: Record<string, unknown>): void {
        const nextQueryParamMap = convertToParamMap(
            toParamMapRecord(queryParams)
        );
        route.snapshot.queryParams = queryParams;
        route.snapshot.queryParamMap = nextQueryParamMap;
        routeQueryParamMap$.next(nextQueryParamMap);
    }

    beforeEach(async () => {
        playlistsLoaded.set(false);
        playlists.set([]);
        jest.clearAllMocks();
        routeParamMap$ = new BehaviorSubject(convertToParamMap({}));
        routeQueryParamMap$ = new BehaviorSubject(convertToParamMap({}));
        workspaceParamMap$ = new BehaviorSubject(convertToParamMap({}));

        const workspaceRoute = {
            snapshot: {
                data: { layout: 'workspace' },
                paramMap: convertToParamMap({}),
                params: {},
            },
            paramMap: workspaceParamMap$.asObservable(),
        } as ActivatedRoute;

        route = {
            snapshot: {
                paramMap: convertToParamMap({}),
                queryParamMap: convertToParamMap({}),
                queryParams: {},
                params: {},
                data: {},
                parent: null,
            },
            paramMap: routeParamMap$.asObservable(),
            queryParamMap: routeQueryParamMap$.asObservable(),
            pathFromRoot: [],
        } as ActivatedRoute & {
            snapshot: {
                paramMap: ReturnType<typeof convertToParamMap>;
                queryParamMap: ReturnType<typeof convertToParamMap>;
                queryParams: Record<string, unknown>;
                params: Record<string, unknown>;
                data: Record<string, unknown>;
                parent: null;
            };
            paramMap: ReturnType<
                BehaviorSubject<
                    ReturnType<typeof convertToParamMap>
                >['asObservable']
            >;
            queryParamMap: ReturnType<
                BehaviorSubject<
                    ReturnType<typeof convertToParamMap>
                >['asObservable']
            >;
            pathFromRoot: ActivatedRoute[];
        };
        route.pathFromRoot = [workspaceRoute, route];

        await TestBed.configureTestingModule({
            imports: [
                UnifiedCollectionPageComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: route,
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: jest.fn((selector: unknown) => {
                            if (selector === selectAllPlaylistsMeta) {
                                return playlists;
                            }
                            if (selector === selectPlaylistsLoadingFlag) {
                                return playlistsLoaded;
                            }
                            return signal(null);
                        }),
                    },
                },
                {
                    provide: ScopeToggleService,
                    useValue: {
                        getScope: jest.fn(() => signal<CollectionScope>('all')),
                        setScope: jest.fn(),
                    },
                },
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: favoritesData,
                },
                {
                    provide: UnifiedRecentDataService,
                    useValue: recentData,
                },
            ],
        })
            .overrideComponent(UnifiedCollectionPageComponent, {
                remove: {
                    imports: [
                        UnifiedGridTabComponent,
                        UnifiedLiveTabComponent,
                    ],
                },
                add: {
                    imports: [
                        StubUnifiedGridTabComponent,
                        StubUnifiedLiveTabComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedCollectionPageComponent);
        fixture.componentRef.setInput('mode', 'favorites');
        fixture.componentRef.setInput('defaultScope', 'all');
    });

    it('reloads favorites after playlist hydration completes', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(1);

        playlists.set([
            {
                _id: 'xtream-1',
                title: 'Xtream One',
                count: 1,
                importDate: '2026-04-03T10:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://example.com',
                favorites: ['fav-1'],
            } as PlaylistMeta,
        ]);
        playlistsLoaded.set(true);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(2);
        expect(favoritesData.getFavorites).toHaveBeenLastCalledWith(
            'all',
            undefined,
            undefined
        );
    });

    it('prefers the route default scope over the persisted collection scope', async () => {
        setRouteParams({ id: 'playlist-1' });
        playlistsLoaded.set(true);
        fixture.componentRef.setInput('portalType', 'm3u');
        fixture.componentRef.setInput('defaultScope', 'playlist');

        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(1);
        expect(favoritesData.getFavorites).toHaveBeenLastCalledWith(
            'playlist',
            'playlist-1',
            'm3u'
        );
    });

    it('does not reload when local item state changes on empty playlist favorites', async () => {
        setRouteParams({ id: 'playlist-1' });
        setRouteQueryParams({ scope: 'playlist' });
        playlistsLoaded.set(true);
        playlists.set([
            {
                _id: 'playlist-1',
                title: 'Playlist One',
                count: 0,
                importDate: '2026-04-05T20:00:00.000Z',
                autoRefresh: false,
                favorites: [],
            } as PlaylistMeta,
        ]);

        fixture.componentRef.setInput('portalType', 'm3u');
        fixture.componentRef.setInput('defaultScope', undefined);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(1);
        expect(favoritesData.getFavorites).toHaveBeenLastCalledWith(
            'playlist',
            'playlist-1',
            'm3u'
        );

        fixture.componentInstance.allItems.set([]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(1);
    });

    it('reloads favorites when the playlist id changes in place', async () => {
        setRouteParams({ id: 'playlist-1' });
        setRouteQueryParams({ scope: 'playlist' });
        playlistsLoaded.set(true);
        fixture.componentRef.setInput('portalType', 'm3u');
        fixture.componentRef.setInput('defaultScope', undefined);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(1);
        expect(favoritesData.getFavorites).toHaveBeenLastCalledWith(
            'playlist',
            'playlist-1',
            'm3u'
        );

        setRouteParams({ id: 'playlist-2' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(2);
        expect(favoritesData.getFavorites).toHaveBeenLastCalledWith(
            'playlist',
            'playlist-2',
            'm3u'
        );
    });

    it('reloads recent items when the playlist id changes in place', async () => {
        setRouteParams({ id: 'playlist-1' });
        setRouteQueryParams({ scope: 'playlist' });
        playlistsLoaded.set(true);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('portalType', 'm3u');
        fixture.componentRef.setInput('defaultScope', undefined);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.getRecentItems).toHaveBeenCalledTimes(1);
        expect(recentData.getRecentItems).toHaveBeenLastCalledWith(
            'playlist',
            'playlist-1',
            'm3u'
        );

        setRouteParams({ id: 'playlist-2' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.getRecentItems).toHaveBeenCalledTimes(2);
        expect(recentData.getRecentItems).toHaveBeenLastCalledWith(
            'playlist',
            'playlist-2',
            'm3u'
        );
    });
});

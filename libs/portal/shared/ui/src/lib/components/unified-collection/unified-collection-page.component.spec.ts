import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
    ViewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DialogService } from 'components';
import {
    COLLECTION_VIEW_STATE_KEY,
    CollectionScope,
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    ScopeToggleService,
    UnifiedCollectionItem,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/util';
import { selectAllPlaylistsMeta, selectPlaylistsLoadingFlag } from 'm3u-state';
import { BehaviorSubject } from 'rxjs';
import { PlaylistMeta } from 'shared-interfaces';
import { UnifiedCollectionPageComponent } from './unified-collection-page.component';
import { UnifiedCollectionDetailDirective } from './unified-collection-detail.directive';
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

    readonly itemSelected = output<UnifiedCollectionItem>();
    readonly removeItem = output<UnifiedCollectionItem>();
}

@Component({
    template: `
        <app-unified-collection-page
            [mode]="mode"
            [portalType]="portalType"
            [defaultScope]="defaultScope"
        >
            <ng-template unifiedCollectionDetail let-item>
                <div class="detail-probe">{{ item.name }}</div>
            </ng-template>
        </app-unified-collection-page>
    `,
    imports: [UnifiedCollectionDetailDirective, UnifiedCollectionPageComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostUnifiedCollectionPageComponent {
    mode: 'favorites' | 'recent' = 'favorites';
    portalType?: string;
    defaultScope: CollectionScope | undefined = 'all';

    @ViewChild(UnifiedCollectionPageComponent)
    pageComponent?: UnifiedCollectionPageComponent;
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
    let routeParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let routeQueryParamMap$: BehaviorSubject<
        ReturnType<typeof convertToParamMap>
    >;
    let workspaceParamMap$: BehaviorSubject<
        ReturnType<typeof convertToParamMap>
    >;
    const playlistsLoaded = signal(false);
    const playlists = signal<PlaylistMeta[]>([]);
    const favoritesData = {
        getFavorites: jest.fn().mockResolvedValue([]),
        clearFavorites: jest.fn().mockResolvedValue(undefined),
        removeFavorite: jest.fn(),
        reorder: jest.fn(),
    };
    const recentData = {
        getRecentItems: jest.fn().mockResolvedValue([]),
        removeRecentItem: jest.fn(),
        clearRecentItems: jest.fn(),
    };
    const dialogService = {
        openConfirmDialog: jest.fn(),
    };
    const router = {
        navigate: jest.fn().mockResolvedValue(true),
        url: '/workspace/global-favorites',
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
                HostUnifiedCollectionPageComponent,
                UnifiedCollectionPageComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: route,
                },
                {
                    provide: Router,
                    useValue: router,
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
                {
                    provide: DialogService,
                    useValue: dialogService,
                },
            ],
        })
            .overrideComponent(UnifiedCollectionPageComponent, {
                remove: {
                    imports: [UnifiedGridTabComponent, UnifiedLiveTabComponent],
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
        window.history.replaceState({}, document.title);
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

    it('clears current favorites through the bulk clear service path', async () => {
        const liveItems = [
            {
                uid: 'm3u::playlist-1::one',
                name: 'Favorite One',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'playlist-1',
                playlistName: 'Playlist One',
                streamUrl: 'https://example.com/one.m3u8',
            },
            {
                uid: 'm3u::playlist-1::two',
                name: 'Favorite Two',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'playlist-1',
                playlistName: 'Playlist One',
                streamUrl: 'https://example.com/two.m3u8',
            },
        ] satisfies UnifiedCollectionItem[];
        favoritesData.getFavorites.mockResolvedValueOnce(liveItems);

        fixture.detectChanges();
        await fixture.whenStable();

        fixture.componentInstance.clearAllCurrent();
        const [dialogConfig] = dialogService.openConfirmDialog.mock.calls.at(
            -1
        ) ?? [null];

        expect(dialogConfig).toBeTruthy();

        await dialogConfig.onConfirm();

        expect(favoritesData.clearFavorites).toHaveBeenCalledTimes(1);
        expect(favoritesData.clearFavorites).toHaveBeenCalledWith(liveItems);
        expect(favoritesData.removeFavorite).not.toHaveBeenCalled();
    });

    it('reloads favorites when bulk clear persistence fails', async () => {
        const liveItems = [
            {
                uid: 'm3u::playlist-1::one',
                name: 'Favorite One',
                contentType: 'live',
                sourceType: 'm3u',
                playlistId: 'playlist-1',
                playlistName: 'Playlist One',
                streamUrl: 'https://example.com/one.m3u8',
            },
        ] satisfies UnifiedCollectionItem[];
        favoritesData.getFavorites
            .mockResolvedValueOnce(liveItems)
            .mockResolvedValueOnce(liveItems);
        favoritesData.clearFavorites.mockRejectedValueOnce(
            new Error('clear failed')
        );

        fixture.detectChanges();
        await fixture.whenStable();

        fixture.componentInstance.clearAllCurrent();
        const [dialogConfig] = dialogService.openConfirmDialog.mock.calls.at(
            -1
        ) ?? [null];

        await dialogConfig.onConfirm();

        expect(favoritesData.getFavorites).toHaveBeenCalledTimes(2);
        expect(favoritesData.getFavorites).toHaveBeenLastCalledWith(
            'all',
            undefined,
            undefined
        );
        expect(fixture.componentInstance.allItems()).toEqual(liveItems);
    });

    it('opens inline detail from history state when a detail template is projected', async () => {
        const item: UnifiedCollectionItem = {
            uid: 'xtream::xtream-1::77',
            name: 'Inline Movie',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream One',
            xtreamId: 77,
            categoryId: 12,
        };
        window.history.replaceState(
            {
                [OPEN_COLLECTION_DETAIL_STATE_KEY]: {
                    item,
                },
            },
            document.title
        );

        const hostFixture = TestBed.createComponent(
            HostUnifiedCollectionPageComponent
        );

        hostFixture.detectChanges();
        await hostFixture.whenStable();
        hostFixture.detectChanges();

        expect(
            hostFixture.nativeElement.querySelector('.detail-probe')
                ?.textContent
        ).toContain('Inline Movie');
        expect(
            hostFixture.componentInstance.pageComponent?.selectedContentType()
        ).toBe('movie');
    });

    it('restores collection scope and selected content type from history state', async () => {
        setRouteParams({ id: 'playlist-1' });
        playlistsLoaded.set(true);
        window.history.replaceState(
            {
                [COLLECTION_VIEW_STATE_KEY]: {
                    selectedContentType: 'movie',
                    scope: 'all',
                },
            },
            document.title
        );

        const restoredFixture = TestBed.createComponent(
            UnifiedCollectionPageComponent
        );
        restoredFixture.componentRef.setInput('mode', 'recent');
        restoredFixture.componentRef.setInput('portalType', 'stalker');
        restoredFixture.componentRef.setInput('defaultScope', 'playlist');

        restoredFixture.detectChanges();
        await restoredFixture.whenStable();

        expect(restoredFixture.componentInstance.scope()).toBe('all');
        expect(restoredFixture.componentInstance.selectedContentType()).toBe(
            'movie'
        );
        expect(recentData.getRecentItems).toHaveBeenLastCalledWith(
            'all',
            'playlist-1',
            'stalker'
        );
    });

    it('closes inline detail when popstate removes the detail state', async () => {
        const item: UnifiedCollectionItem = {
            uid: 'stalker::stalker-1::series-9',
            name: 'Inline Series',
            contentType: 'series',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker One',
            stalkerId: 'series-9',
            categoryId: 'series',
        };
        const hostFixture = TestBed.createComponent(
            HostUnifiedCollectionPageComponent
        );

        hostFixture.detectChanges();
        await hostFixture.whenStable();
        hostFixture.componentInstance.pageComponent?.onGridItemSelected(item);
        hostFixture.detectChanges();

        expect(
            hostFixture.nativeElement.querySelector('.detail-probe')
                ?.textContent
        ).toContain('Inline Series');

        window.history.replaceState({}, document.title);
        window.dispatchEvent(new PopStateEvent('popstate'));
        await hostFixture.whenStable();
        hostFixture.detectChanges();

        expect(
            hostFixture.nativeElement.querySelector('.detail-probe')
        ).toBeNull();
    });

    it('routes cross-provider collection detail opens through the global collection route', async () => {
        const item: UnifiedCollectionItem = {
            uid: 'xtream::xtream-1::77',
            name: 'Cross Provider Movie',
            contentType: 'movie',
            sourceType: 'xtream',
            playlistId: 'xtream-1',
            playlistName: 'Xtream One',
            xtreamId: 77,
            categoryId: 12,
        };
        const hostFixture = TestBed.createComponent(
            HostUnifiedCollectionPageComponent
        );
        setRouteParams({ id: 'host-playlist' });
        router.url = '/workspace/stalker/host/recent';
        hostFixture.componentInstance.mode = 'recent';
        hostFixture.componentInstance.portalType = 'stalker';

        hostFixture.detectChanges();
        await hostFixture.whenStable();
        hostFixture.componentInstance.pageComponent?.onScopeChange('all');
        hostFixture.componentInstance.pageComponent?.onContentTypeChange(
            'movie'
        );

        hostFixture.componentInstance.pageComponent?.onGridItemSelected(item);

        expect(window.history.state).toEqual(
            expect.objectContaining({
                [COLLECTION_VIEW_STATE_KEY]: {
                    selectedContentType: 'movie',
                    scope: 'all',
                },
            })
        );
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'global-recent'],
            {
                state: {
                    [OPEN_COLLECTION_DETAIL_STATE_KEY]: {
                        item: expect.objectContaining({
                            uid: item.uid,
                            name: item.name,
                            contentType: item.contentType,
                            sourceType: item.sourceType,
                            playlistId: item.playlistId,
                            playlistName: item.playlistName,
                            xtreamId: item.xtreamId,
                            categoryId: String(item.categoryId),
                        }),
                    },
                },
            }
        );
    });
});

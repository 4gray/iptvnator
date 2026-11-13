import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import {
    buildOpenLiveCollectionItemState,
    OPEN_LIVE_COLLECTION_ITEM_STATE_KEY,
    ScopeToggleService,
    UnifiedCollectionItem,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import {
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { of } from 'rxjs';
import { UnifiedCollectionPageComponent } from './unified-collection-page.component';
import {
    findPendingNonLiveOpen,
    openPendingNonLiveItem,
} from './unified-collection-pending-open';
import { UnifiedGridTabComponent } from './unified-grid-tab.component';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';

const FILM_URL = 'http://h.example/movie/u/p/1.mkv';
const EPISODE_URL = 'http://h.example/series/u/p/7.mkv';
const LIVE_URL = 'http://h.example/live/u/p/3.ts';

function m3uItem(
    contentType: UnifiedCollectionItem['contentType'],
    streamUrl: string,
    name: string,
    channelId?: string
): UnifiedCollectionItem {
    return {
        uid: `m3u::pl-1::${streamUrl}`,
        name,
        contentType,
        sourceType: 'm3u',
        playlistId: 'pl-1',
        playlistName: 'Playlist One',
        streamUrl,
        ...(channelId ? { channelId } : {}),
    };
}

const FILM = m3uItem('movie', FILM_URL, 'Sandline', 'row-1');
const EPISODE = m3uItem('series', EPISODE_URL, 'Harbour S01E02', 'row-7');
const LIVE = m3uItem('live', LIVE_URL, 'Example News');

function target(itemId: string, title?: string) {
    return buildOpenLiveCollectionItemState({
        sourceType: 'm3u',
        playlistId: 'pl-1',
        itemId,
        title,
    });
}

describe('findPendingNonLiveOpen', () => {
    it('finds the film or episode a live-typed M3U target points at', () => {
        const items = [LIVE, FILM, EPISODE];

        expect(findPendingNonLiveOpen(items, target(FILM_URL))).toBe(FILM);
        expect(findPendingNonLiveOpen(items, target(EPISODE_URL))).toBe(
            EPISODE
        );
    });

    it('leaves a live row, another playlist and portal targets alone', () => {
        const items = [LIVE, FILM];

        expect(findPendingNonLiveOpen(items, null)).toBeNull();
        expect(findPendingNonLiveOpen(items, target(LIVE_URL))).toBeNull();
        expect(
            findPendingNonLiveOpen(items, {
                ...target(FILM_URL),
                playlistId: 'pl-2',
            })
        ).toBeNull();
        expect(
            findPendingNonLiveOpen(items, {
                ...target(FILM_URL),
                sourceType: 'xtream',
            })
        ).toBeNull();
    });

    it('prefers the exact stream over a row that only shares the title', () => {
        const namesake = m3uItem(
            'movie',
            'http://h.example/movie/u/p/2.mkv',
            'Sandline'
        );

        expect(
            findPendingNonLiveOpen(
                [namesake, FILM],
                target(FILM_URL, 'Sandline')
            )
        ).toBe(FILM);
    });
});

describe('openPendingNonLiveItem', () => {
    it('reports a row without a stream URL instead of navigating', () => {
        const router = { navigate: jest.fn(), url: '/x' };
        const orphan = { ...FILM, streamUrl: undefined };

        expect(
            openPendingNonLiveItem([orphan], target('', 'Sandline'), router)
        ).toEqual({ item: orphan, navigated: false });
        expect(router.navigate).not.toHaveBeenCalled();
    });
});

@Component({
    selector: 'app-unified-live-tab',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubLiveTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly searchTerm = input('');
    readonly autoOpenItem = input<unknown>(null);
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly sortMode = input<unknown>('custom');
    readonly isSidebarCollapsed = input(false);
    readonly reloading = input(false);
}

@Component({
    selector: 'app-unified-grid-tab',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubGridTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly contentType = input<'movie' | 'series'>('movie');
    readonly searchTerm = input('');
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly favoriteToggled = output<UnifiedCollectionItem>();
}

describe('UnifiedCollectionPageComponent M3U film and episode handoff', () => {
    let fixture: ComponentFixture<UnifiedCollectionPageComponent>;
    const router = {
        navigate: jest.fn().mockResolvedValue(true),
        url: '/workspace/playlists/pl-1/recent',
    };
    const favoritesData = {
        addFavorite: jest.fn().mockResolvedValue(undefined),
        removeFavorite: jest.fn().mockResolvedValue(undefined),
        getFavorites: jest.fn().mockResolvedValue([]),
        membershipUid: jest.fn((item: UnifiedCollectionItem) => item.uid),
    };
    const recentData = { getRecentItems: jest.fn() };

    async function render(
        items: UnifiedCollectionItem[],
        pending?: ReturnType<typeof target>
    ): Promise<void> {
        recentData.getRecentItems.mockResolvedValue(items);
        // The page reads the handoff once, while it is constructed.
        window.history.replaceState(
            pending ? { [OPEN_LIVE_COLLECTION_ITEM_STATE_KEY]: pending } : {},
            document.title
        );
        fixture = TestBed.createComponent(UnifiedCollectionPageComponent);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('portalType', 'm3u');
        fixture.componentRef.setInput('defaultScope', 'playlist');
        await settle();
    }

    /** The load is a promise chain the fixture does not track on its own. */
    async function settle(): Promise<void> {
        fixture.detectChanges();
        await new Promise((resolve) => setTimeout(resolve));
        await fixture.whenStable();
        fixture.detectChanges();
    }

    beforeEach(async () => {
        jest.clearAllMocks();
        const paramMap = convertToParamMap({ id: 'pl-1' });
        const route = {
            snapshot: {
                paramMap,
                queryParamMap: convertToParamMap({}),
                queryParams: {},
                params: { id: 'pl-1' },
                data: {},
                parent: null,
            },
            paramMap: of(paramMap),
            queryParamMap: of(convertToParamMap({})),
            pathFromRoot: [] as unknown[],
        };
        route.pathFromRoot = [route];

        await TestBed.configureTestingModule({
            imports: [
                UnifiedCollectionPageComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: ActivatedRoute, useValue: route },
                { provide: Router, useValue: router },
                {
                    provide: Store,
                    useValue: { selectSignal: jest.fn(() => signal(null)) },
                },
                {
                    provide: ScopeToggleService,
                    useValue: {
                        getScope: jest.fn(() => signal('playlist')),
                        setScope: jest.fn(),
                    },
                },
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: favoritesData,
                },
                { provide: UnifiedRecentDataService, useValue: recentData },
                {
                    provide: DialogService,
                    useValue: { openConfirmDialog: jest.fn() },
                },
                {
                    provide: WorkspaceViewCommandService,
                    useValue: {
                        registerCommand: jest.fn(() => jest.fn()),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsEpg: false },
                },
            ],
        })
            .overrideComponent(UnifiedCollectionPageComponent, {
                remove: {
                    imports: [UnifiedGridTabComponent, UnifiedLiveTabComponent],
                },
                add: { imports: [StubGridTabComponent, StubLiveTabComponent] },
            })
            .compileComponents();
    });

    afterEach(() => window.history.replaceState({}, document.title));

    it.each([
        ['film', FILM, FILM_URL, 'row-1'],
        ['episode', EPISODE, EPISODE_URL, 'row-7'],
    ])(
        'opens a dashboard-selected M3U %s in its playlist and settles the handoff',
        async (_kind, item, url, channelId) => {
            await render([LIVE, item], target(url, item.name));

            expect(router.navigate).toHaveBeenCalledWith(
                ['/workspace', 'playlists', 'pl-1', 'all'],
                {
                    state: {
                        openM3uChannelUrl: url,
                        openM3uChannelId: channelId,
                    },
                    replaceUrl: true,
                }
            );
            expect(
                fixture.componentInstance.pendingAutoOpenLiveItem()
            ).toBeNull();
            expect(window.history.state).not.toHaveProperty(
                OPEN_LIVE_COLLECTION_ITEM_STATE_KEY
            );
        }
    );

    it('shows the tab of a selected film that has no stream to open', async () => {
        // Nothing to hand the player, so the viewer is left on the tab
        // that lists the row instead of on Live, and the handoff is spent.
        const orphan = { ...FILM, streamUrl: undefined };
        // The handoff names the row by its id; the URL is what is gone.
        await render([LIVE, orphan], target('row-1', FILM.name));

        expect(router.navigate).not.toHaveBeenCalled();
        expect(fixture.componentInstance.selectedContentType()).toBe('movie');
        expect(fixture.componentInstance.pendingAutoOpenLiveItem()).toBeNull();
    });

    it('still hands a live M3U row to the live tab', async () => {
        const pending = target(LIVE_URL, LIVE.name);
        await render([FILM, LIVE], pending);

        expect(router.navigate).not.toHaveBeenCalled();
        expect(fixture.componentInstance.selectedContentType()).toBe('live');
        expect(
            fixture.debugElement
                .query(By.directive(StubLiveTabComponent))
                .componentInstance.autoOpenItem()
        ).toEqual(pending);
    });

    it('favourites and unfavourites a recent M3U film from its grid card', async () => {
        await render([FILM]);
        const grid = fixture.debugElement.query(
            By.directive(StubGridTabComponent)
        ).componentInstance as StubGridTabComponent;
        expect(grid.favoriteUids().has(FILM.uid)).toBe(false);

        grid.favoriteToggled.emit(FILM);
        await settle();

        expect(favoritesData.addFavorite).toHaveBeenCalledWith(FILM);
        expect(grid.favoriteUids().has(FILM.uid)).toBe(true);

        grid.favoriteToggled.emit(FILM);
        await settle();

        expect(favoritesData.removeFavorite).toHaveBeenCalledWith(FILM);
    });
});

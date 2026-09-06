import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import {
    StalkerPortalError,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { WORKSPACE_CATEGORY_SORT_STORAGE_KEY } from '@iptvnator/portal/shared/util';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';
import {
    XtreamContentLoadState,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { LiveLayoutSidebarStateService } from '@iptvnator/portal/shared/util';
import { WorkspaceContextPanelComponent } from './workspace-context-panel.component';

const translations: Record<string, string> = {
    'WORKSPACE.CONTEXT.MANAGE_CATEGORIES': 'Manage categories',
    'WORKSPACE.CONTEXT.RADIO_CATEGORIES': 'Radio Categories',
    'WORKSPACE.CONTEXT.XTREAM_SYNCING_LIVE': 'Syncing live categories...',
    'WORKSPACE.CONTEXT.XTREAM_SYNCING_MOVIES': 'Syncing movie categories...',
    'WORKSPACE.CATEGORY_SORT_ARIA': 'Sort categories',
    'WORKSPACE.SORT_LABEL': 'Sort: ',
    'WORKSPACE.SORT_NAME_ASC': 'Name A-Z',
    'WORKSPACE.SORT_NAME_DESC': 'Name Z-A',
    'WORKSPACE.SORT_SERVER': 'Server sorting',
    'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING':
        'Fetching playlist data from source...',
};

interface RouteSnapshotStub {
    routeConfig: { path: string } | null;
    paramMap: { has: (param: string) => boolean };
    children: RouteSnapshotStub[];
}

function createRouteSnapshot(
    path: string | null,
    hasCategoryId = false,
    children: RouteSnapshotStub[] = []
): RouteSnapshotStub {
    return {
        routeConfig: path ? { path } : null,
        paramMap: {
            has: (param: string) => hasCategoryId && param === 'categoryId',
        },
        children,
    };
}

function getCategoryLabels(
    fixture: ComponentFixture<WorkspaceContextPanelComponent>
): string[] {
    return Array.from(
        fixture.nativeElement.querySelectorAll('.category-item .nav-item-label')
    ).map((element: Element) => element.textContent?.trim() ?? '');
}

describe('WorkspaceContextPanelComponent', () => {
    let fixture: ComponentFixture<WorkspaceContextPanelComponent>;
    const xtreamCategories = signal([
        { id: 1, name: 'News' },
        { id: 2, name: 'Sports' },
    ]);
    const xtreamCategoryItemCounts = signal(new Map<number, number>());
    const xtreamSelectedCategoryId = signal<number | null>(null);
    const xtreamSelectedTypeContentState =
        signal<XtreamContentLoadState>('loading');
    const xtreamImportPhase = signal<string | null>('loading-live');
    const xtreamIsImporting = signal(true);
    const xtreamIsLoadingCategories = signal(false);

    const xtreamStore = {
        getCategoriesBySelectedType: xtreamCategories,
        getCategoryItemCounts: xtreamCategoryItemCounts,
        selectedCategoryId: xtreamSelectedCategoryId,
        selectedTypeContentState: xtreamSelectedTypeContentState,
        selectedTypeContentReady: computed(
            () => xtreamSelectedTypeContentState() === 'ready'
        ),
        selectedTypeCountsReady: computed(
            () => xtreamSelectedTypeContentState() === 'ready'
        ),
        isImporting: xtreamIsImporting,
        currentImportPhase: xtreamImportPhase,
        isLoadingCategories: xtreamIsLoadingCategories,
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        reloadCategories: jest.fn(),
    };
    const stalkerStore = {
        getCategoryResource: signal<
            Array<{ category_id: string; category_name: string }>
        >([]),
        selectedCategoryId: signal<string | null>(null),
        isCategoryResourceLoading: signal(false),
        isCategoryResourceFailed: signal(false),
        itvFullListActive: signal(false),
        itvFullListLoading: signal(false),
        itvCategoryItemCounts: signal<Map<number, number>>(new Map()),
        setSelectedCategory: jest.fn(),
        setPage: jest.fn(),
        clearSelectedItem: jest.fn(),
    };
    const router = {
        routerState: {
            snapshot: {
                root: createRouteSnapshot(null),
            },
        },
        navigate: jest.fn(),
    };
    const dialog = {
        open: jest.fn(),
    };
    const drawerOpen = signal(false);

    beforeEach(async () => {
        localStorage.removeItem(WORKSPACE_CATEGORY_SORT_STORAGE_KEY);
        xtreamCategories.set([
            { id: 1, name: 'News' },
            { id: 2, name: 'Sports' },
        ]);
        xtreamCategoryItemCounts.set(new Map());
        xtreamSelectedCategoryId.set(null);
        xtreamSelectedTypeContentState.set('loading');
        xtreamImportPhase.set('loading-live');
        xtreamIsImporting.set(true);
        xtreamIsLoadingCategories.set(false);
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.reloadCategories.mockClear();
        stalkerStore.getCategoryResource.set([]);
        stalkerStore.selectedCategoryId.set(null);
        stalkerStore.setSelectedCategory.mockClear();
        stalkerStore.setPage.mockClear();
        stalkerStore.clearSelectedItem.mockClear();
        router.routerState.snapshot.root = createRouteSnapshot(null, false, [
            createRouteSnapshot('live'),
        ]);
        router.navigate.mockClear();
        dialog.open.mockClear();
        drawerOpen.set(false);

        await TestBed.configureTestingModule({
            imports: [WorkspaceContextPanelComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => translations[key] ?? key,
                        get: (key: string) => of(translations[key] ?? key),
                        stream: (key: string) => of(translations[key] ?? key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: xtreamStore,
                },
                {
                    provide: StalkerStore,
                    useValue: stalkerStore,
                },
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
                {
                    // Root-provided in production; stubbed because the spec's
                    // Router mock has no `events` stream for the real service.
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { close: jest.fn(), isOpen: drawerOpen },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(WorkspaceContextPanelComponent);
        fixture.componentRef.setInput('context', {
            provider: 'xtreams',
            playlistId: 'playlist-1',
        });
    });

    it('renders loading meta and blocks xtream category clicks until counts are ready', () => {
        fixture.componentRef.setInput('section', 'live');
        fixture.detectChanges();

        const countPlaceholders = fixture.nativeElement.querySelectorAll(
            '.item-count--loading'
        );
        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];
        const status = fixture.nativeElement.querySelector(
            '.context-inline-status'
        ) as HTMLElement | null;
        const manageButton = fixture.nativeElement.querySelector(
            '[data-test-id="context-manage-categories"]'
        ) as HTMLButtonElement | null;

        expect(countPlaceholders).toHaveLength(2);
        expect(categoryButtons.every((button) => button.disabled)).toBe(true);
        expect(status?.textContent).toContain('Syncing live categories...');
        expect(status?.textContent).toContain(
            'Fetching playlist data from source...'
        );
        expect(manageButton?.disabled).toBe(true);

        categoryButtons[0]?.click();

        expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
        expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('keeps local xtream loading states quiet when no import is running', () => {
        fixture.componentRef.setInput('section', 'vod');
        xtreamIsImporting.set(false);
        fixture.detectChanges();

        const countPlaceholders = fixture.nativeElement.querySelectorAll(
            '.item-count--loading'
        );
        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];
        const status = fixture.nativeElement.querySelector(
            '.context-inline-status'
        ) as HTMLElement | null;

        expect(countPlaceholders).toHaveLength(2);
        expect(categoryButtons.every((button) => button.disabled)).toBe(true);
        expect(status).toBeNull();
    });

    it('shows real counts and enables navigation once the selected xtream type is ready', () => {
        fixture.componentRef.setInput('section', 'vod');
        xtreamSelectedTypeContentState.set('ready');
        xtreamImportPhase.set(null);
        xtreamCategoryItemCounts.set(
            new Map([
                [1, 3],
                [2, 0],
            ])
        );
        fixture.detectChanges();

        const countTexts = Array.from(
            fixture.nativeElement.querySelectorAll('.item-count')
        ).map((element: Element) => element.textContent?.trim());
        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];
        const manageButton = fixture.nativeElement.querySelector(
            '[data-test-id="context-manage-categories"]'
        ) as HTMLButtonElement | null;

        expect(countTexts).toEqual(['3', '0']);
        expect(categoryButtons.every((button) => !button.disabled)).toBe(true);
        expect(manageButton?.disabled).toBe(false);

        categoryButtons[1]?.click();

        expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(2);
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            2,
        ]);
    });

    it('keeps xtream categories in server order by default and sorts them from the menu modes', () => {
        fixture.componentRef.setInput('section', 'vod');
        xtreamSelectedTypeContentState.set('ready');
        xtreamCategories.set([
            { id: 1, name: 'Sports' },
            { id: 2, name: 'Movies' },
            { id: 3, name: 'News' },
        ]);
        fixture.detectChanges();

        expect(getCategoryLabels(fixture)).toEqual([
            'Sports',
            'Movies',
            'News',
        ]);

        fixture.componentInstance.setCategorySortMode('name-asc');
        fixture.detectChanges();

        expect(getCategoryLabels(fixture)).toEqual([
            'Movies',
            'News',
            'Sports',
        ]);

        fixture.componentInstance.setCategorySortMode('name-desc');
        fixture.detectChanges();

        expect(getCategoryLabels(fixture)).toEqual([
            'Sports',
            'News',
            'Movies',
        ]);
        expect(localStorage.getItem(WORKSPACE_CATEGORY_SORT_STORAGE_KEY)).toBe(
            'name-desc'
        );
    });

    it('uses translated category sort labels and distinct mode icons', () => {
        fixture.componentRef.setInput('section', 'vod');
        xtreamSelectedTypeContentState.set('ready');
        fixture.detectChanges();

        const sortButton = Array.from(
            fixture.nativeElement.querySelectorAll('.context-header__action')
        ).at(1) as HTMLButtonElement | undefined;

        expect(sortButton?.getAttribute('aria-label')).toBe('Sort categories');
        expect(fixture.componentInstance.categorySortLabelKey()).toBe(
            'WORKSPACE.SORT_SERVER'
        );
        expect(fixture.componentInstance.categorySortIcon()).toBe('dns');
        expect(
            fixture.componentInstance.categorySortOptions.map((option) => ({
                mode: option.mode,
                translationKey: option.translationKey,
                icon: option.icon,
            }))
        ).toEqual([
            {
                mode: 'server',
                translationKey: 'WORKSPACE.SORT_SERVER',
                icon: 'dns',
            },
            {
                mode: 'name-asc',
                translationKey: 'WORKSPACE.SORT_NAME_ASC',
                icon: 'sort_by_alpha',
            },
            {
                mode: 'name-desc',
                translationKey: 'WORKSPACE.SORT_NAME_DESC',
                icon: 'arrow_downward',
            },
        ]);

        fixture.componentInstance.setCategorySortMode('name-desc');
        fixture.detectChanges();

        expect(fixture.componentInstance.categorySortLabelKey()).toBe(
            'WORKSPACE.SORT_NAME_DESC'
        );
        expect(fixture.componentInstance.categorySortIcon()).toBe(
            'arrow_downward'
        );
    });

    it('applies the category sort menu modes to stalker categories', () => {
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'series');
        stalkerStore.getCategoryResource.set([
            { category_id: '*', category_name: 'All Categories' },
            { category_id: 'z', category_name: 'Zulu' },
            { category_id: 'a', category_name: 'Alpha' },
            { category_id: 'm', category_name: 'Movies' },
        ]);
        fixture.detectChanges();

        expect(getCategoryLabels(fixture)).toEqual([
            'All Categories',
            'Zulu',
            'Alpha',
            'Movies',
        ]);

        fixture.componentInstance.setCategorySortMode('name-asc');
        fixture.detectChanges();

        expect(getCategoryLabels(fixture)).toEqual([
            'All Categories',
            'Alpha',
            'Movies',
            'Zulu',
        ]);

        fixture.componentInstance.setCategorySortMode('name-desc');
        fixture.detectChanges();

        expect(getCategoryLabels(fixture)).toEqual([
            'All Categories',
            'Zulu',
            'Movies',
            'Alpha',
        ]);
    });

    it('shows per-genre count badges on stalker Live TV categories when the full list is cached', () => {
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'itv');
        stalkerStore.getCategoryResource.set([
            { category_id: '*', category_name: 'All' },
            { category_id: '1', category_name: 'Documentary' },
            { category_id: '2', category_name: 'Sports' },
        ]);
        stalkerStore.itvFullListActive.set(true);
        stalkerStore.itvCategoryItemCounts.set(
            new Map<number, number>([
                [1, 190],
                [2, 38],
                [Number.NaN, 228],
            ])
        );
        fixture.detectChanges();

        const counts = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item .item-count')
        ).map((el) => (el as HTMLElement).textContent?.trim());
        // "All" (NaN key → total), Documentary, Sports.
        expect(counts).toEqual(['228', '190', '38']);
    });

    it('omits the badge for censored stalker genres missing from the count map', () => {
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'itv');
        stalkerStore.getCategoryResource.set([
            { category_id: '1', category_name: 'Documentary' },
            {
                category_id: '19',
                category_name: 'For adults',
                censored: true,
            } as never,
        ]);
        stalkerStore.itvFullListActive.set(true);
        // Censored genre 19 has no entry — its real count is unknown.
        stalkerStore.itvCategoryItemCounts.set(
            new Map<number, number>([[1, 190]])
        );
        fixture.detectChanges();

        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLElement[];
        const documentary = categoryButtons.find((el) =>
            el.textContent?.includes('Documentary')
        );
        const adults = categoryButtons.find((el) =>
            el.textContent?.includes('For adults')
        );

        expect(documentary?.querySelector('.item-count')?.textContent).toContain(
            '190'
        );
        expect(adults?.querySelector('.item-count')).toBeNull();
    });

    it('hides count badges for stalker categories without a cached full list (e.g. VOD)', () => {
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'vod');
        stalkerStore.getCategoryResource.set([
            { category_id: '1', category_name: 'Action' },
        ]);
        stalkerStore.itvFullListActive.set(false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.category-item .item-count')
        ).toBeNull();
    });

    describe('folded categories rail', () => {
        let liveSidebarService: LiveLayoutSidebarStateService;

        beforeEach(() => {
            liveSidebarService = TestBed.inject(LiveLayoutSidebarStateService);
            liveSidebarService.setState('portal', 'expanded');
        });

        afterEach(() => {
            liveSidebarService.setState('portal', 'expanded');
        });

        function hideButton(): HTMLButtonElement | null {
            return fixture.nativeElement.querySelector(
                '[data-test-id="context-hide-categories"]'
            );
        }

        it('offers the hide-categories chevron on live sections of the sidebar and folds the rail', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedCategoryId.set(1);
            fixture.detectChanges();

            const button = hideButton();
            expect(button).not.toBeNull();
            expect(button?.getAttribute('aria-label')).toBe(
                'LAYOUT.HIDE_CATEGORIES'
            );

            button?.click();

            expect(liveSidebarService.stateOf('portal')()).toBe('categories-hidden');
        });

        it('offers it for Stalker itv and radio too', () => {
            fixture.componentRef.setInput('context', {
                provider: 'stalker',
                playlistId: 'stalker-1',
            });
            fixture.componentRef.setInput('section', 'radio');
            stalkerStore.selectedCategoryId.set('12');
            fixture.detectChanges();

            expect(hideButton()).not.toBeNull();
        });

        it('withholds the chevron inside the open phone drawer, whose stylesheet ignores the folded state', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedCategoryId.set(1);
            drawerOpen.set(true);
            fixture.detectChanges();

            expect(hideButton()).toBeNull();
        });

        it('names the chevron as focus target, the first header action without one, and nothing while categories are absent', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedCategoryId.set(1);
            fixture.detectChanges();
            expect(fixture.componentInstance.focusTarget()).toBe(hideButton());

            // Live root: no chevron, the search action stands in.
            xtreamSelectedCategoryId.set(null);
            fixture.detectChanges();
            expect(fixture.componentInstance.focusTarget()).toBe(
                fixture.nativeElement.querySelector('.context-header__action')
            );

            // Nothing loaded yet: no control at all, the caller falls back.
            xtreamCategories.set([]);
            fixture.detectChanges();
            expect(fixture.componentInstance.focusTarget()).toBeNull();
        });

        it('withholds the chevron while no category is selected (live root has no channels rail)', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedCategoryId.set(null);
            fixture.detectChanges();

            expect(hideButton()).toBeNull();
        });

        it('keeps VOD and series rails without the chevron', () => {
            fixture.componentRef.setInput('section', 'vod');
            xtreamSelectedCategoryId.set(1);
            fixture.detectChanges();

            expect(hideButton()).toBeNull();
        });

        it('renders no chevron in the popover presentation, whose footer restores the rail instead', () => {
            fixture.componentRef.setInput('section', 'live');
            fixture.componentRef.setInput('presentation', 'popover');
            xtreamSelectedCategoryId.set(1);
            fixture.detectChanges();

            expect(hideButton()).toBeNull();
        });

        it('shares the category sort with a second (popover) instance of the panel', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedCategoryId.set(1);
            fixture.detectChanges();
            fixture.componentInstance.setCategorySortMode('name-desc');

            const popover = TestBed.createComponent(
                WorkspaceContextPanelComponent
            );
            popover.componentRef.setInput('context', {
                provider: 'xtreams',
                playlistId: 'playlist-1',
            });
            popover.componentRef.setInput('section', 'live');
            popover.componentRef.setInput('presentation', 'popover');
            popover.detectChanges();
            expect(popover.componentInstance.categorySortMode()).toBe(
                'name-desc'
            );

            popover.componentInstance.setCategorySortMode('name-asc');
            expect(fixture.componentInstance.categorySortMode()).toBe(
                'name-asc'
            );
            popover.destroy();
        });

        it('keeps the live-TV column keyboard contract out of the popover', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedCategoryId.set(1);
            xtreamSelectedTypeContentState.set('ready');
            fixture.detectChanges();
            expect(
                fixture.nativeElement.querySelector('#portal-categories')
            ).not.toBeNull();

            fixture.componentRef.setInput('presentation', 'popover');
            fixture.detectChanges();
            expect(
                fixture.nativeElement.querySelector('#portal-categories')
            ).toBeNull();

            // ArrowRight on the selected category must not reach the
            // background channels pane from inside the dialog.
            const pane = document.createElement('div');
            pane.id = 'live-channels';
            pane.tabIndex = -1;
            document.body.appendChild(pane);
            pane.checkVisibility = () => true;
            try {
                const selected = fixture.nativeElement.querySelector(
                    '.category-item[aria-current="true"]'
                ) as HTMLButtonElement;
                selected.focus();
                const event = new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                });
                selected.dispatchEvent(event);

                expect(event.defaultPrevented).toBe(false);
                expect(document.activeElement).toBe(selected);
            } finally {
                pane.remove();
            }
        });

        it('reports a category selection so a popover host can close', () => {
            fixture.componentRef.setInput('section', 'live');
            xtreamSelectedTypeContentState.set('ready');
            fixture.detectChanges();
            const selected = jest.fn();
            fixture.componentInstance.categorySelected.subscribe(selected);

            const categoryButtons = Array.from(
                fixture.nativeElement.querySelectorAll('.category-item')
            ) as HTMLButtonElement[];
            categoryButtons[1]?.click();

            expect(selected).toHaveBeenCalledTimes(1);
        });
    });

    it('preserves the active xtream live item when switching live categories', () => {
        fixture.componentRef.setInput('section', 'live');
        xtreamSelectedTypeContentState.set('ready');
        fixture.detectChanges();

        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];

        categoryButtons[1]?.click();

        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(2);
        expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('updates the live category URL without clearing playback when already deep linked', () => {
        fixture.componentRef.setInput('section', 'live');
        router.routerState.snapshot.root = createRouteSnapshot(null, false, [
            createRouteSnapshot('live/:categoryId', true),
        ]);
        xtreamSelectedTypeContentState.set('ready');
        fixture.detectChanges();

        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];

        categoryButtons[1]?.click();

        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(2);
        expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'playlist-1', 'live', 2],
            {
                queryParamsHandling: 'preserve',
                replaceUrl: true,
            }
        );
    });

    it('labels Stalker radio categories and keeps the playing station on a category click', () => {
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'radio');
        stalkerStore.getCategoryResource.set([
            { category_id: '*', category_name: 'All radio' },
        ]);
        fixture.detectChanges();

        const title = fixture.nativeElement.querySelector(
            '.context-header h2'
        ) as HTMLElement;
        const categoryButton = fixture.nativeElement.querySelector(
            '.category-item'
        ) as HTMLButtonElement;

        expect(title.textContent).toContain('Radio Categories');

        categoryButton.click();

        expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith('*');
        expect(stalkerStore.setPage).toHaveBeenCalledWith(0);
        // The radio layout renders its audio player only while the store has
        // a selected item — clearing it here would silence the station.
        expect(stalkerStore.clearSelectedItem).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('preserves the playing Stalker ITV channel when switching live categories', () => {
        // Regression: the click handler used to clearSelectedItem() for every
        // Stalker section. The live layout gates its player on selectedItem,
        // so a category switch in the sidebar stopped a channel the user never
        // switched away from — unlike Xtream live (#936) and M3U groups.
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'itv');
        stalkerStore.getCategoryResource.set([
            { category_id: '*', category_name: 'All channels' },
            { category_id: '7', category_name: 'Sports' },
        ]);
        fixture.detectChanges();

        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];

        categoryButtons[1]?.click();

        expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith('7');
        expect(stalkerStore.setPage).toHaveBeenCalledWith(0);
        expect(stalkerStore.clearSelectedItem).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('still closes the open Stalker detail when switching VOD categories', () => {
        // VOD/series category clicks navigate to a list route, so the open
        // detail must be dropped there — the live exemption is deliberate and
        // narrow.
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'vod');
        stalkerStore.getCategoryResource.set([
            { category_id: '*', category_name: 'All movies' },
            { category_id: '7', category_name: 'Action' },
        ]);
        fixture.detectChanges();

        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];

        categoryButtons[1]?.click();

        expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith('7');
        expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'stalker',
            'stalker-1',
            'vod',
            '7',
        ]);
    });

    describe('Stalker category error description', () => {
        afterEach(() => {
            stalkerStore.isCategoryResourceFailed.set(false as never);
        });

        it('leads with the remedy for a device conflict', () => {
            // The portal blames the hardware ("Your STB is damaged"), which
            // is the opposite of actionable — the explanation has to come
            // first, with the portal's own words kept after it.
            stalkerStore.isCategoryResourceFailed.set(
                new StalkerPortalError(
                    'device-conflict',
                    'device conflict - device_id mismatch — Your STB is damaged.'
                ) as never
            );

            expect(fixture.componentInstance.stalkerCategoryErrorDescription()).toBe(
                'PORTALS.ERROR_VIEW.STALKER_DEVICE_CONFLICT device conflict - device_id mismatch — Your STB is damaged.'
            );
        });

        it('still relays any other refusal verbatim', () => {
            stalkerStore.isCategoryResourceFailed.set(
                new StalkerPortalError('blocked', 'Account disabled') as never
            );

            expect(fixture.componentInstance.stalkerCategoryErrorDescription()).toBe(
                'Account disabled'
            );
        });
    });
});

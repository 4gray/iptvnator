import { Component, Directive, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { Subject, of } from 'rxjs';
import {
    LIVE_CATEGORIES_POPOVER,
    LIVE_SIDEBAR_STATE_STORAGE_KEY,
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
    ResizableDirective,
} from '@iptvnator/portal/shared/util';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { EpgListViewComponent, EpgTimelineComponent } from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';

/**
 * The channels header while the shell's categories rail is folded: the
 * category dropdown, the show-categories chevron and the collapse-all
 * chevron. Split from `live-stream-layout.component.spec.ts`, which sits at
 * the spec line cap; the harness here renders no player, no EPG and no
 * channel list.
 */

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    template: '',
})
class StubPortalChannelsListComponent {
    readonly sortMode = input('server');
    readonly channelsOverride = input<unknown[] | null>(null);
    readonly searchTermInput = input('');
    readonly fullscreenPanelCopy = input(false);
    readonly revealRequest = input<unknown>(null);
    readonly filteredChannels = signal<unknown[]>([]);
    readonly playClicked = output<unknown>();
    readonly playbackRequested = output<unknown>();
}

@Component({ selector: 'app-grid-list', standalone: true, template: '' })
class StubGridListComponent {
    readonly items = input<unknown[]>([]);
    readonly isLoading = input(false);
    readonly searchTerm = input('');
    readonly variant = input('poster');
    readonly type = input<string>();
    readonly itemClicked = output<unknown>();
}

@Component({
    selector: 'app-web-player-view, app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: '',
})
class StubPassiveComponent {}

@Directive({ selector: '[appResizable]', standalone: true })
class StubResizableDirective {}

describe('LiveStreamLayoutComponent sidebar levels', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let service: LiveLayoutSidebarStateService;
    const categoriesPopover = { open: jest.fn(), close: jest.fn() };
    const selectedCategoryId = signal<number | null>(1);
    const emptyList = signal<unknown[]>([]);
    const xtreamStore = {
        getCategoriesBySelectedType: signal([
            { category_id: 1, category_name: 'News' },
        ]),
        getCategoryItemCounts: signal(new Map<number, number>([[1, 7]])),
        getPaginatedContent: emptyList,
        hasMoreContent: signal(false),
        epgItems: emptyList,
        currentEpgItem: signal(null),
        isLoadingEpg: signal(false),
        selectedTypeContentLoading: signal(false),
        selectedCategoryId,
        selectedContentType: signal('live'),
        // No selected item: the content area shows the empty state, so the
        // header is the only thing under test.
        selectedItem: signal(null),
        currentPlaylist: signal({ _id: 'pl-1', title: 'Playlist' }),
        liveStreams: emptyList,
        selectItemsFromSelectedCategory: jest.fn(() => []),
        constructStreamUrl: jest.fn(() => ''),
        openPlayer: jest.fn(),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        loadMoreContent: jest.fn(),
    };

    function query<T extends HTMLElement>(selector: string): T | null {
        return fixture.nativeElement.querySelector(selector);
    }

    beforeEach(async () => {
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
        categoriesPopover.open.mockClear();
        categoriesPopover.close.mockClear();
        selectedCategoryId.set(1);

        await TestBed.configureTestingModule({
            imports: [LiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: of(convertToParamMap({})),
                        pathFromRoot: [
                            { snapshot: { data: { layout: 'workspace' } } },
                        ],
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        events: new Subject().asObservable(),
                        navigate: jest.fn(),
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                {
                    provide: FavoritesService,
                    useValue: { getFavorites: jest.fn(() => of([])) },
                },
                {
                    provide: XtreamUrlService,
                    useValue: { resolveCatchupUrl: jest.fn() },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: false,
                        isElectron: false,
                        supportsRemoteControl: false,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openExternalPlayback: jest.fn(),
                    },
                },
                { provide: LIVE_CATEGORIES_POPOVER, useValue: categoriesPopover },
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GridListComponent,
                        PortalChannelsListComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubGridListComponent,
                        StubPassiveComponent,
                        StubPortalChannelsListComponent,
                        StubResizableDirective,
                        MockPipe(TranslatePipe, (value: string) => value),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        service = TestBed.inject(LiveLayoutSidebarStateService);
        service.setState('expanded');
    });

    afterEach(() => {
        service.setState('expanded');
        fixture.destroy();
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
    });

    it('keeps the plain category heading while the rail is expanded', () => {
        fixture.detectChanges();

        expect(query('[data-test-id="live-category-dropdown"]')).toBeNull();
        expect(query('[data-test-id="live-show-categories"]')).toBeNull();
        expect(query('.category-heading')?.textContent).toContain('News');
    });

    it('keeps the plain heading for a search-only rail with no selected category', () => {
        selectedCategoryId.set(null);
        service.hideCategories();
        fixture.detectChanges();

        // No category and no search term: the layout renders no rail at all.
        expect(query('.sidebar')).toBeNull();
        expect(query('[data-test-id="live-category-dropdown"]')).toBeNull();
    });

    it('turns the heading into a category dropdown that opens the shell popover', () => {
        service.hideCategories();
        fixture.detectChanges();

        const dropdown = query<HTMLButtonElement>(
            '[data-test-id="live-category-dropdown"]'
        );
        expect(dropdown).not.toBeNull();
        expect(dropdown?.textContent).toContain('News');
        expect(dropdown?.textContent).toContain('7');
        expect(dropdown?.getAttribute('aria-label')).toBe(
            'LAYOUT.CHOOSE_CATEGORY'
        );
        expect(query('.category-heading')).toBeNull();

        dropdown?.click();

        expect(categoriesPopover.open).toHaveBeenCalledWith(dropdown);
    });

    it('restores the rail from the show-categories button and closes any open popover', () => {
        service.hideCategories();
        fixture.detectChanges();

        query<HTMLButtonElement>(
            '[data-test-id="live-show-categories"]'
        )?.click();

        expect(categoriesPopover.close).toHaveBeenCalledTimes(1);
        expect(service.state()).toBe('expanded');
    });

    it('collapses both rails from the header chevron and comes back to the same level', () => {
        service.hideCategories();
        fixture.detectChanges();

        query<HTMLButtonElement>(
            '.sidebar-header [aria-label="LAYOUT.HIDE_PANELS"]'
        )?.click();
        fixture.detectChanges();

        expect(service.state()).toBe('collapsed');
        expect(query('.sidebar')?.classList).toContain('sidebar-collapsed');
        const restore = query<HTMLButtonElement>('.sidebar-restore');
        expect(restore?.getAttribute('aria-label')).toBe('LAYOUT.SHOW_PANELS');

        restore?.click();

        expect(service.state()).toBe('categories-hidden');
    });

    it('picks focus up on the show-categories button when the rail folds and focus was lost', async () => {
        fixture.detectChanges();
        (document.activeElement as HTMLElement | null)?.blur();

        service.hideCategories();
        fixture.detectChanges();
        await new Promise((resolve) => queueMicrotask(resolve));

        expect(document.activeElement).toBe(
            query('[data-test-id="live-show-categories"]')
        );
    });

    it('leaves focus alone when a control still owns it', async () => {
        fixture.detectChanges();
        const sort = query<HTMLButtonElement>(
            '.sidebar-header [aria-label="Sort channels"]'
        );
        sort?.focus();

        service.hideCategories();
        fixture.detectChanges();
        await new Promise((resolve) => queueMicrotask(resolve));

        expect(document.activeElement).toBe(sort);
    });

    it('hands focus to the floating restore handle at player-only and back to show-categories on expand', async () => {
        service.hideCategories();
        fixture.detectChanges();
        (document.activeElement as HTMLElement | null)?.blur();

        service.collapse();
        fixture.detectChanges();
        await new Promise((resolve) => queueMicrotask(resolve));
        expect(document.activeElement).toBe(query('.sidebar-restore'));

        // The handle is removed with the expand, so focus is lost again.
        service.expand();
        fixture.detectChanges();
        await new Promise((resolve) => queueMicrotask(resolve));
        expect(document.activeElement).toBe(
            query('[data-test-id="live-show-categories"]')
        );
    });

    it('hands focus to show-categories when the first category selection folds the rail on the live root', async () => {
        selectedCategoryId.set(null);
        service.hideCategories();
        fixture.detectChanges();
        (document.activeElement as HTMLElement | null)?.blur();

        // The category button the user activated is inert now: focus lost.
        selectedCategoryId.set(1);
        fixture.detectChanges();
        await new Promise((resolve) => queueMicrotask(resolve));

        expect(document.activeElement).toBe(
            query('[data-test-id="live-show-categories"]')
        );
    });

    it('shows the floating restore button at player-only even without a selected category, and hides it when expanded', () => {
        selectedCategoryId.set(null);
        service.collapse();
        fixture.detectChanges();
        expect(query('.sidebar-restore')).not.toBeNull();

        selectedCategoryId.set(1);
        service.expand();
        fixture.detectChanges();
        expect(query('.sidebar-restore')).toBeNull();
    });

    it('persists the channels sidebar width under a dedicated storage key', () => {
        // The shell context panel (category sidebar) is visible at the same
        // time as this sidebar and persists its width under the shared
        // "sidebar-width" key. Reusing that key here makes the two panels
        // overwrite each other's stored width across reloads.
        fixture.detectChanges();

        expect(query('.sidebar')?.getAttribute('storageKey')).toBe(
            'live-channels-sidebar-width'
        );
    });

    it('marks the folded channels rail inert at player-only', () => {
        service.collapse();
        fixture.detectChanges();

        expect(query('.sidebar')?.hasAttribute('inert')).toBe(true);

        service.expand();
        fixture.detectChanges();

        expect(query('.sidebar')?.hasAttribute('inert')).toBe(false);
    });

    it('answers Cmd/Ctrl+B with the same nested toggle', () => {
        service.hideCategories();
        fixture.detectChanges();

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'b', ctrlKey: true })
        );
        expect(service.state()).toBe('collapsed');

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'b', metaKey: true })
        );
        expect(service.state()).toBe('categories-hidden');
    });
});

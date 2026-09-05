import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { ElectronStreamHeadersService } from '@iptvnator/ui/playback';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

const FILL_CHECK_DELAY_MS = 100;

/**
 * Focused spec for the fullscreen panel's search on a paged portal — kept
 * separate from the main layout spec, which sits at the max-lines budget.
 */
describe('StalkerLiveStreamLayoutComponent fullscreen panel search', () => {
    let fixture: ComponentFixture<StalkerLiveStreamLayoutComponent>;
    let component: StalkerLiveStreamLayoutComponent;
    const channels = [
        {
            id: 'channel-one',
            cmd: 'ffrt4://itv/channel-one',
            name: 'One',
            o_name: 'One',
            logo: 'one.png',
        },
        {
            id: 'channel-two',
            cmd: 'ffrt4://itv/channel-two',
            name: 'Two',
            o_name: 'Two',
            logo: 'two.png',
        },
    ];
    const hasMoreChannels = signal(false);
    const page = signal(0);
    const itvChannels = signal(channels);
    const searchPhrase = signal('');
    const itvFullListActive = signal(false);
    const itvSelectedCategoryFromCache = signal(false);
    const store = {
        getSelectedCategoryName: signal('All'),
        currentPlaylist: signal({ _id: 'playlist-one', title: 'Portal One' }),
        selectedContentType: signal<'itv' | 'radio'>('itv'),
        selectedCategoryId: signal<string | null>('all'),
        selectedItvId: signal<string | undefined>(undefined),
        selectedItem: signal(null),
        itvChannels,
        radioChannels: signal([]),
        searchPhrase,
        hasMoreChannels,
        page,
        // A legacy paged portal by default: no full-list cache in memory.
        itvFullListActive,
        itvSelectedCategoryFromCache,
        itvFullListLoading: signal(false),
        itvFullListProgress: signal(null),
        itvFullChannelList: signal<typeof channels>([]),
        isPaginatedContentLoading: signal(false),
        selectedItvEpgPrograms: signal([]),
        bulkItvEpgByChannel: signal({}),
        isLoadingBulkItvEpg: signal(false),
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        preloadItvChannels: jest.fn(),
        applyMappedItvEpg: jest.fn(),
        clearBulkItvEpgCache: jest.fn(),
        ensureBulkItvEpg: jest.fn(),
        fetchChannelEpg: jest.fn(),
        resolveItvPlayback: jest.fn(),
        resolveRadioPlayback: jest.fn(),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
        setSelectedItem: jest.fn(),
    };

    const settle = () =>
        new Promise((resolve) => setTimeout(resolve, FILL_CHECK_DELAY_MS + 20));

    beforeEach(async () => {
        hasMoreChannels.set(false);
        page.set(0);
        itvChannels.set(channels);
        searchPhrase.set('');
        itvFullListActive.set(false);
        itvSelectedCategoryFromCache.set(false);
        store.selectedCategoryId.set('all');
        store.itvFullChannelList.set([]);
        store.setPage.mockClear();
        await TestBed.configureTestingModule({
            imports: [
                TranslateModule.forRoot(),
                StalkerLiveStreamLayoutComponent,
            ],
            providers: [
                { provide: StalkerStore, useValue: store },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: false,
                        isElectron: false,
                        supportsEpgMapping: false,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: () => of([]) },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: { apply: jest.fn(), clear: jest.fn() },
                },
                {
                    provide: LiveLayoutSidebarStateService,
                    useValue: { isCollapsed: signal(false), toggle: jest.fn() },
                },
                { provide: EpgRuntimeBridgeService, useValue: {} },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        // Let the initial fill check (no more pages yet) come and go.
        await settle();
        store.setPage.mockClear();
    });

    afterEach(() => fixture.destroy());

    it('keeps requesting pages while an empty panel search cannot scroll', async () => {
        // A term with no match on the loaded page renders nothing the user
        // could scroll, yet later pages may hold the channel — so the empty
        // result itself must reach provider pagination.
        hasMoreChannels.set(true);

        expect(component.channelsForList(signal('zzz-nomatch'))).toEqual([]);
        await settle();

        expect(store.setPage).toHaveBeenCalledWith(1);
    });

    it('stops at the last page', async () => {
        hasMoreChannels.set(false);

        expect(component.channelsForList(signal('zzz-nomatch'))).toEqual([]);
        await settle();

        expect(store.setPage).not.toHaveBeenCalled();
    });

    it('ends the in-flight state when a page lands that the sidebar search hides', async () => {
        // The panel's search asked for the page; the sidebar's own term
        // matches none of it, so the sidebar shows no row — that must not
        // leave the request flagged as still in flight, or the panel could
        // never ask for the page after it.
        hasMoreChannels.set(true);
        searchPhrase.set('sidebar-term-matching-nothing');
        fixture.detectChanges();
        expect(component.visibleChannels()).toEqual([]);

        component.loadMore();
        expect(store.setPage).toHaveBeenCalledWith(1);
        expect(component.isLoadingMore()).toBe(true);

        page.set(1);
        itvChannels.set([
            ...channels,
            {
                id: 'channel-three',
                cmd: 'ffrt4://itv/channel-three',
                name: 'Three',
                o_name: 'Three',
                logo: 'three.png',
            },
        ]);
        fixture.detectChanges();

        expect(component.isLoadingMore()).toBe(false);
    });

    it('shows the whole category under a blank panel search, whatever the sidebar searches', () => {
        // The sidebar's term narrows the sidebar; the panel's empty field
        // must not inherit it, or the panel shows an unexplained subset (or
        // an empty state) under an empty search box.
        searchPhrase.set('one');
        fixture.detectChanges();
        expect(component.visibleChannels().map((c) => c.id)).toEqual([
            'channel-one',
        ]);

        const blank = signal('');
        expect(component.hasSearchTerm(blank)).toBe(false);
        expect(component.channelsForList(blank).map((c) => c.id)).toEqual([
            'channel-one',
            'channel-two',
        ]);
        // The sidebar copy (no panel signal) keeps its own search.
        expect(component.hasSearchTerm()).toBe(true);
        expect(component.channelsForList().map((c) => c.id)).toEqual([
            'channel-one',
        ]);
    });

    it('grows the blank panel against the category, not the sidebar search', () => {
        // Cached full-list category of 150 rows, sidebar narrowed to one:
        // `hasMoreItems` says the sidebar is complete, yet the blank panel is
        // showing the first 100 of 150 and must still be able to reach the rest.
        itvFullListActive.set(true);
        itvSelectedCategoryFromCache.set(true);
        itvChannels.set(
            Array.from({ length: 150 }, (_, index) => ({
                id: `channel-${index}`,
                cmd: `ffrt4://itv/channel-${index}`,
                name: index === 7 ? 'Needle' : `Channel ${index}`,
                o_name: `Channel ${index}`,
                logo: '',
            }))
        );
        searchPhrase.set('needle');
        fixture.detectChanges();

        const blank = signal('');
        expect(component.visibleChannels()).toHaveLength(1);
        expect(component.hasMoreItems()).toBe(false);
        expect(component.channelsForList(blank)).toHaveLength(100);
        expect(component.panelIdleHasMore()).toBe(true);

        component.loadMoreForPanel();
        expect(component.channelsForList(blank)).toHaveLength(150);
        expect(component.panelIdleHasMore()).toBe(false);
        // The sidebar copy is untouched by the panel's growth.
        expect(component.visibleChannels()).toHaveLength(1);
    });

    it('windows the full cache under a blank panel search when All Items has no category', () => {
        const fullList = Array.from({ length: 250 }, (_, index) => ({
            ...channels[0],
            id: `full-${index}`,
            name: `Full channel ${index}`,
        }));
        store.selectedCategoryId.set(null);
        itvFullListActive.set(true);
        store.itvFullChannelList.set(fullList);
        itvChannels.set([]);
        searchPhrase.set('sidebar-no-match');

        const blank = signal('');
        expect(component.channelsForList(blank)).toEqual(
            fullList.slice(0, 100)
        );
        expect(component.panelIdleHasMore()).toBe(true);
        component.loadMoreForPanel();
        expect(component.channelsForList(blank)).toEqual(
            fullList.slice(0, 200)
        );
        component.loadMoreForPanel();
        expect(component.channelsForList(blank)).toEqual(fullList);
        expect(component.panelIdleHasMore()).toBe(false);
        component.loadMoreForPanel();
        expect(store.setPage).not.toHaveBeenCalled();

        store.selectedCategoryId.set('chosen-category');
        itvSelectedCategoryFromCache.set(true);
        itvChannels.set(channels);
        expect(component.channelsForList(blank)).toEqual(channels);
    });

    it('marks the sidebar copy as the live-channels keyboard pane', () => {
        // The category list's ArrowRight hand-off looks the pane up by id;
        // the sidebar copy owns it (the panel copy, stamped with a search
        // signal, renders none).
        const container = component.scrollContainers()[0].nativeElement;
        expect(container.id).toBe('live-channels');
        expect(container.getAttribute('tabindex')).toBe('0');
        expect(container.classList.contains('app-scrollbar')).toBe(true);
    });

    it('leaves the sidebar alone while its own search is active', async () => {
        // Only the panel copy fills itself during a sidebar search; the
        // sidebar has never paged automatically then, and this fixture
        // renders the sidebar copy only.
        hasMoreChannels.set(true);
        searchPhrase.set('one');
        fixture.detectChanges();
        await settle();

        expect(store.setPage).not.toHaveBeenCalled();
    });

    it('pauses automatic paging while the panel is closed and resumes on reopen', async () => {
        hasMoreChannels.set(true);
        searchPhrase.set('sidebar-no-match');
        fixture.detectChanges();
        const container = component.scrollContainers()[0].nativeElement;
        const panel = document.createElement('aside');
        panel.className = 'fullscreen-channel-panel';
        container.parentElement.appendChild(panel);
        panel.appendChild(container);
        container.classList.add('fullscreen-channel-list');
        // Reattach the real listener after placing the stamped list inside
        // the same persistent aside used by the fullscreen panel.
        component['setupScrollListener']();
        component.channelsForList(signal('panel-no-match'));
        await settle();
        expect(store.setPage).toHaveBeenCalledTimes(1);

        panel.setAttribute('inert', '');
        page.set(1);
        itvChannels.set([...channels]);
        fixture.detectChanges();
        await settle();
        container.dispatchEvent(new Event('scroll'));
        expect(component.isLoadingMore()).toBe(false);
        expect(store.setPage).toHaveBeenCalledTimes(1);

        // No new query or page arrives to wake the closed list: opening
        // alone must resume filling its still-empty search result.
        panel.removeAttribute('inert');
        await settle();
        expect(store.setPage).toHaveBeenCalledTimes(2);
        expect(store.setPage).toHaveBeenLastCalledWith(2);
    });
    it('scrolls a blank panel through the cached category independently of sidebar matches', async () => {
        const category = Array.from({ length: 250 }, (_, index) => ({
            ...channels[0],
            id: `channel-${index}`,
            name: `Channel ${index}`,
            o_name: `Channel ${index}`,
        }));
        store.itvFullListActive.set(true);
        store.itvSelectedCategoryFromCache.set(true);
        itvChannels.set(category);
        searchPhrase.set('Channel 249');
        fixture.detectChanges();
        await settle();

        const blank = signal('');
        const container = component.scrollContainers()[0].nativeElement;
        // Exercise the installed scroll listener with the panel copy's DOM
        // marker. The sidebar's one matching row has no more items.
        container.classList.add('fullscreen-channel-list');
        Object.defineProperties(container, {
            scrollHeight: { configurable: true, value: 1000 },
            clientHeight: { configurable: true, value: 200 },
        });
        expect(component.hasMoreItems()).toBe(false);
        expect(component.channelsForList(blank)).toHaveLength(100);

        container.scrollTop = 0;
        container.dispatchEvent(new Event('scroll'));
        expect(component.channelsForList(blank)).toHaveLength(100);

        container.scrollTop = 800;
        container.dispatchEvent(new Event('scroll'));
        expect(component.channelsForList(blank)).toHaveLength(200);
        container.dispatchEvent(new Event('scroll'));
        expect(component.channelsForList(blank)).toEqual(category);
        container.dispatchEvent(new Event('scroll'));
        expect(component.channelsForList(blank)).toEqual(category);
        expect(component.visibleChannels()).toEqual([category[249]]);
        expect(store.setPage).not.toHaveBeenCalled();
    });
});

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
        // A legacy paged portal: no full-list cache to search in memory.
        itvFullListActive: signal(false),
        itvSelectedCategoryFromCache: signal(false),
        itvFullListLoading: signal(false),
        itvFullListProgress: signal(null),
        itvFullChannelList: signal([]),
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
});

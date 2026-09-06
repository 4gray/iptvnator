import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    ActivatedRoute,
    convertToParamMap,
    NavigationEnd,
    Router,
} from '@angular/router';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamStore,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

const target = { xtream_id: 202, category_id: '7', name: 'Search Channel' };
const alpha = { xtream_id: 201, category_id: '7', name: 'Alpha' };
const zulu = { xtream_id: 203, category_id: '7', name: 'Zulu' };
const other = { xtream_id: 101, category_id: '1', name: 'Other' };
const catalog = [other, target, zulu, alpha];

describe('Xtream live auto-open playback queue', () => {
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const selectedCategoryId = signal<number | null>(1);
    const selectedItem = signal<XtreamLiveChannelItem | null>(null);
    const categorySearchTerm = signal('');
    const visibleItems = computed(() =>
        catalog.filter(
            (item) =>
                (!selectedCategoryId() ||
                    Number(item.category_id) === selectedCategoryId()) &&
                item.name
                    .toLowerCase()
                    .includes(categorySearchTerm().toLowerCase())
        )
    );
    let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let events: Subject<NavigationEnd>;
    const store = {
        getCategoriesBySelectedType: signal([
            { category_id: 1 },
            { category_id: 7 },
        ]),
        getCategoryItemCounts: signal(new Map()),
        epgItems: signal([]),
        currentEpgItem: signal(null),
        selectedTypeContentLoading: signal(false),
        isLoadingEpg: signal(false),
        selectedCategoryId,
        selectedItem,
        categorySearchTerm,
        selectedContentType: signal('live'),
        currentPlaylist: signal({ id: 'playlist-1' }),
        liveStreams: signal(catalog),
        getPaginatedContent: signal(catalog),
        hasMoreContent: signal(false),
        selectItemsFromSelectedCategory: visibleItems,
        setSelectedCategory: jest.fn((id: number) =>
            selectedCategoryId.set(id)
        ),
        setSelectedItem: jest.fn((item: XtreamLiveChannelItem) =>
            selectedItem.set(item)
        ),
        constructStreamUrl: jest.fn((item: XtreamLiveChannelItem) => {
            selectedItem.set(item);
            return `https://example.test/live/${item.xtream_id}.ts`;
        }),
    };

    beforeEach(async () => {
        selectedCategoryId.set(1);
        selectedItem.set(null);
        categorySearchTerm.set('');
        store.constructStreamUrl.mockClear();
        store.setSelectedCategory.mockClear();
        window.history.replaceState({}, '');
        localStorage.removeItem('xtream-live-channel-sort-mode');
        query = new BehaviorSubject(convertToParamMap({}));
        events = new Subject();
        await TestBed.configureTestingModule({
            imports: [LiveStreamLayoutComponent],
            providers: [
                { provide: XtreamStore, useValue: store },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            data: {},
                            params: {},
                            queryParamMap: convertToParamMap({}),
                        },
                        queryParamMap: query,
                        pathFromRoot: [
                            { snapshot: { data: { layout: 'workspace' } } },
                        ],
                    },
                },
                { provide: Router, useValue: { events, navigate: jest.fn() } },
                {
                    provide: FavoritesService,
                    useValue: { getFavorites: () => of([]) },
                },
                {
                    provide: XtreamUrlService,
                    useValue: { constructAutoLiveTsUrl: () => undefined },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: { isEmbeddedPlayer: () => true },
                },
                { provide: RecordingsService, useValue: {} },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        isElectron: false,
                        supportsEpg: false,
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
            ],
        })
            .overrideComponent(LiveStreamLayoutComponent, {
                set: { template: '', imports: [] },
            })
            .compileComponents();
        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        component.setLiveChannelSortMode('name-asc');
    });

    afterEach(() => {
        fixture.destroy();
        window.history.replaceState({}, '');
        localStorage.removeItem('xtream-live-channel-sort-mode');
    });

    it.each([
        { category: 1, query: 'Other' },
        { category: null, query: '' },
    ])(
        'auto-opens with the destination category queue from $category',
        ({ category, query: previousQuery }) => {
            selectedCategoryId.set(category);
            categorySearchTerm.set(previousQuery);
            query.next(convertToParamMap({ q: previousQuery }));
            window.history.replaceState(
                { openXtreamLiveItemId: target.xtream_id },
                ''
            );
            events.next(new NavigationEnd(1, '/live', '/live'));
            fixture.detectChanges();

            expect(store.setSelectedCategory).toHaveBeenCalledWith(7);
            expect(component.channelNavigation.remoteChannels()).toEqual([
                alpha,
                target,
                zulu,
            ]);
            component['handleRemoteChannelChange']('down');
            expect(store.constructStreamUrl).toHaveBeenLastCalledWith(zulu);
        }
    );

    it('keeps the actual displayed cross-category list for an explicit All Items click', () => {
        selectedCategoryId.set(null);
        component.onLiveRootItemClick(target);
        expect(component.channelNavigation.remoteChannels()).toEqual(catalog);
    });
});

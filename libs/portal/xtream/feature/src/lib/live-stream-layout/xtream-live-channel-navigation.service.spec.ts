import { Component, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    ActivatedRoute,
    convertToParamMap,
    NavigationStart,
    Router,
    provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LiveLayoutSidebarStateService } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { BehaviorSubject, Subject } from 'rxjs';
import { XtreamLiveChannelNavigationService } from './xtream-live-channel-navigation.service';

const first = { xtream_id: 1, category_id: '10', title: 'Zulu' };
const second = { xtream_id: 2, category_id: '10', title: 'Alpha' };
const other = { xtream_id: 3, category_id: '20', title: 'Other' };

@Component({
    template: '',
    providers: [XtreamLiveChannelNavigationService],
})
class NavigationHostComponent {
    readonly navigation = inject(XtreamLiveChannelNavigationService);
}

describe('XtreamLiveChannelNavigationService', () => {
    const currentPlaylist = signal({ id: 'source-1' });
    const selectedContentType = signal('live');
    const selectedCategoryId = signal<number | null>(10);
    const categorySearchTerm = signal('');
    const liveStreams = signal([first, second, other]);
    const categories = signal([
        { category_id: 10, hidden: false },
        { category_id: 20, hidden: false },
    ]);
    const selectedChannels = computed(() =>
        liveStreams().filter(
            (item) =>
                (!selectedCategoryId() ||
                    Number(item.category_id) === selectedCategoryId()) &&
                item.title
                    .toLowerCase()
                    .includes(categorySearchTerm().toLowerCase())
        )
    );
    const store = {
        currentPlaylist,
        selectedContentType,
        selectedCategoryId,
        categorySearchTerm,
        liveStreams,
        getCategoriesBySelectedType: categories,
        selectItemsFromSelectedCategory: selectedChannels,
        setSelectedCategory: jest.fn((id: number) =>
            selectedCategoryId.set(id)
        ),
        setCategorySearchTerm: jest.fn((term: string) =>
            categorySearchTerm.set(term)
        ),
        constructStreamUrl: jest.fn(),
        openPlayer: jest.fn(),
        setSelectedItem: jest.fn(),
    };
    let service: XtreamLiveChannelNavigationService;
    let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let events: Subject<NavigationStart>;
    let route: {
        snapshot: {
            params: Record<string, string>;
            queryParamMap: ReturnType<typeof convertToParamMap>;
        };
        queryParamMap: unknown;
    };
    const navigate = jest.fn();
    const sidebar = { setState: jest.fn() };

    beforeEach(() => {
        currentPlaylist.set({ id: 'source-1' });
        selectedContentType.set('live');
        selectedCategoryId.set(10);
        categorySearchTerm.set('');
        liveStreams.set([first, second, other]);
        categories.set([
            { category_id: 10, hidden: false },
            { category_id: 20, hidden: false },
        ]);
        query = new BehaviorSubject(convertToParamMap({}));
        events = new Subject();
        route = {
            snapshot: { params: {}, queryParamMap: convertToParamMap({}) },
            queryParamMap: query.asObservable(),
        };
        jest.clearAllMocks();
        navigate.mockImplementation(() => {
            events.next(new NavigationStart(1, '/live'));
            query.next(convertToParamMap({}));
            return Promise.resolve(true);
        });
        TestBed.configureTestingModule({
            providers: [
                XtreamLiveChannelNavigationService,
                { provide: XtreamStore, useValue: store },
                { provide: ActivatedRoute, useValue: route },
                { provide: Router, useValue: { events, navigate } },
                { provide: LiveLayoutSidebarStateService, useValue: sidebar },
            ],
        });
        service = TestBed.inject(XtreamLiveChannelNavigationService);
        TestBed.flushEffects();
    });

    it('captures the displayed sort and keeps it after category, search, and sort changes', () => {
        service.sortMode.set('name-asc');
        service.capture(first);
        selectedCategoryId.set(20);
        service.sortMode.set('name-desc');
        query.next(convertToParamMap({ q: 'Other' }));
        expect(service.remoteChannels()).toEqual([second, first]);
        service.capture(second, service.displayedChannels(), true);
        expect(service.remoteChannels()).toEqual([second, first]);
        service.capture(second);
        expect(service.remoteChannels()).toEqual([second, first]);
    });

    it('captures fullscreen filtered rows and replaces the queue on a new explicit selection', () => {
        service.capture(first, [first]);
        expect(service.remoteChannels()).toEqual([first]);
        service.capture(other, [other, second]);
        expect(service.remoteChannels()).toEqual([other, second]);
    });

    it('drops hidden and removed channels without adopting the browsed list', () => {
        selectedCategoryId.set(null);
        service.capture(first);
        categories.set([
            { category_id: 10, hidden: false },
            { category_id: 20, hidden: true },
        ]);
        expect(service.remoteChannels()).toEqual([first, second]);
        liveStreams.set([second, other]);
        expect(service.remoteChannels()).toEqual([second]);
        expect(service.canReveal()).toBe(false);
    });

    it('invalidates a queue when its source or content type changes', () => {
        service.capture(first);
        currentPlaylist.set({ id: 'source-2' });
        expect(service.remoteChannels()).toEqual([]);
        TestBed.flushEffects();
        currentPlaylist.set({ id: 'source-1' });
        expect(service.remoteChannels()).toEqual([]);
        service.capture(first);
        selectedContentType.set('vod');
        TestBed.flushEffects();
        selectedContentType.set('live');
        expect(service.remoteChannels()).toEqual([]);
        expect(service.activeItem()).toBeNull();
    });

    it('shows reveal only when the playing channel is absent from the actual filtered list', () => {
        service.capture(first);
        expect(service.canReveal()).toBe(false);
        query.next(convertToParamMap({ q: 'Alpha' }));
        expect(service.canReveal()).toBe(true);
        categories.set([{ category_id: 10, hidden: true }]);
        expect(service.canReveal()).toBe(false);
    });

    it.each([false, true])(
        'reveals from a category route=%s without touching playback or queue',
        async (categoryRoute) => {
            service.capture(first);
            selectedCategoryId.set(20);
            categorySearchTerm.set('Other');
            query.next(convertToParamMap({ q: 'Other' }));
            if (categoryRoute) route.snapshot.params = { categoryId: '20' };
            await service.reveal();
            expect(navigate).toHaveBeenCalledWith(
                categoryRoute ? ['../', 10] : [],
                {
                    relativeTo: route,
                    queryParams: { q: null },
                    queryParamsHandling: 'merge',
                }
            );
            expect(selectedCategoryId()).toBe(10);
            expect(categorySearchTerm()).toBe('');
            expect(sidebar.setState).toHaveBeenCalledWith('portal', 'expanded');
            expect(service.revealRequest()).toEqual(
                expect.objectContaining({ channelId: 1 })
            );
            expect(service.remoteChannels()).toEqual([first, second]);
            expect(store.constructStreamUrl).not.toHaveBeenCalled();
            expect(store.openPlayer).not.toHaveBeenCalled();
            expect(store.setSelectedItem).not.toHaveBeenCalled();
        }
    );

    it.each(['live', 'live/20', 'live-without-query'])(
        'keeps the live host mounted and synchronizes real %s navigation',
        async (path) => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    provideRouter([
                        {
                            path: 'workspace/xtreams/:id',
                            children: [
                                {
                                    path: 'live',
                                    component: NavigationHostComponent,
                                },
                                {
                                    path: 'live/:categoryId',
                                    component: NavigationHostComponent,
                                },
                            ],
                        },
                    ]),
                    { provide: XtreamStore, useValue: store },
                    {
                        provide: LiveLayoutSidebarStateService,
                        useValue: sidebar,
                    },
                ],
            });
            selectedCategoryId.set(20);
            const harness = await RouterTestingHarness.create();
            const host = await harness.navigateByUrl(
                `/workspace/xtreams/source-1/${path === 'live-without-query' ? 'live' : `${path}?q=Other`}`,
                NavigationHostComponent
            );
            host.navigation.capture(first, [first, second]);
            await host.navigation.reveal();
            harness.detectChanges();
            expect(TestBed.inject(Router).url).toBe(
                `/workspace/xtreams/source-1/${path !== 'live/20' ? 'live' : 'live/10'}`
            );
            expect(harness.routeDebugElement?.componentInstance).toBe(host);
            expect(selectedCategoryId()).toBe(10);
            expect(host.navigation.revealRequest()?.channelId).toBe(
                first.xtream_id
            );
            expect(host.navigation.remoteChannels()).toEqual([first, second]);
        }
    );

    it.each([
        'playback',
        'source',
        'category',
        'navigation',
        'hidden',
        'cancelled',
    ])('ignores a stale reveal after %s changes', async (change) => {
        route.snapshot.params = { categoryId: '20' };
        service.capture(first);
        selectedCategoryId.set(20);
        let finish!: (value: boolean) => void;
        navigate.mockImplementation(() => {
            events.next(new NavigationStart(1, '/live'));
            return new Promise<boolean>((resolve) => {
                finish = resolve;
            });
        });
        const reveal = service.reveal();
        if (change === 'playback') service.capture(other);
        if (change === 'source') currentPlaylist.set({ id: 'source-2' });
        if (change === 'category') selectedCategoryId.set(30);
        if (change === 'navigation')
            events.next(new NavigationStart(2, '/elsewhere'));
        if (change === 'hidden')
            categories.set([{ category_id: 10, hidden: true }]);
        finish(change !== 'cancelled');
        await reveal;
        expect(store.setSelectedCategory).not.toHaveBeenCalled();
        expect(sidebar.setState).not.toHaveBeenCalled();
        expect(service.revealRequest()).toBeNull();
    });
});

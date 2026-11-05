import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { ContentType, XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RecentlyAddedComponent } from './recently-added.component';

jest.mock('@iptvnator/portal/shared/ui', () => ({
    ContentCardComponent: class {},
    ContentRailShellComponent: class {},
}));

interface TestRecentlyAddedItem {
    readonly added?: string;
    readonly category_id: number;
    readonly last_modified?: string;
    readonly poster_url: string;
    readonly title: string;
    readonly xtream_id: number;
}

function toEpochSeconds(iso: string): string {
    return String(Math.floor(Date.parse(iso) / 1000));
}

function createItem(
    index: number,
    overrides: Partial<TestRecentlyAddedItem> = {}
): TestRecentlyAddedItem {
    return {
        added: toEpochSeconds('2026-05-18T00:00:00.000Z'),
        category_id: 10,
        poster_url: '',
        title: `Item ${index}`,
        xtream_id: index,
        ...overrides,
    };
}

class MockXtreamStore {
    readonly liveStreams = signal<TestRecentlyAddedItem[]>([]);
    readonly vodStreams = signal<TestRecentlyAddedItem[]>([]);
    readonly serialStreams = signal<TestRecentlyAddedItem[]>([]);
    readonly getVisibleContentByType = jest.fn(
        () =>
            (type: ContentType): TestRecentlyAddedItem[] => {
                switch (type) {
                    case 'live':
                        return this.liveStreams();
                    case 'vod':
                        return this.vodStreams();
                    case 'series':
                        return this.serialStreams();
                }
            }
    );
    readonly currentPlaylist = signal({ id: 'playlist-1' });
    readonly isLoadingContent = signal(false);
    readonly isLoadingCategories = signal(false);
    readonly isImporting = signal(false);
    readonly setSelectedContentType = jest.fn();
}

describe('RecentlyAddedComponent', () => {
    let store: MockXtreamStore;
    let dateNowSpy: jest.SpyInstance<number, []>;
    let router: { navigate: jest.Mock };

    beforeEach(() => {
        dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-05-19T00:00:00.000Z'));

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XtreamStore,
                    useClass: MockXtreamStore,
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: jest.fn(),
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {},
                },
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        instant: jest.fn((key: string) => key),
                        onLangChange: of(null),
                        onDefaultLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                    },
                },
            ],
        });

        store = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;
        router = TestBed.inject(Router) as unknown as { navigate: jest.Mock };
    });

    afterEach(() => {
        dateNowSpy.mockRestore();
    });

    it('shows up to 30 recently added VOD items after filtering invalid provider dates', () => {
        const freshItems = Array.from({ length: 31 }, (_, index) =>
            createItem(index + 1, {
                added: String(
                    Math.floor(
                        (Date.parse('2026-05-18T00:00:00.000Z') -
                            index * 60_000) /
                            1000
                    )
                ),
                title: `Fresh ${index + 1}`,
                xtream_id: index + 1,
            })
        );
        const futureItem = createItem(999, {
            added: toEpochSeconds('2030-01-01T00:00:00.000Z'),
            title: 'Future Provider Item',
            xtream_id: 999,
        });

        store.vodStreams.set([futureItem, ...freshItems]);

        const component = TestBed.runInInjectionContext(
            () => new RecentlyAddedComponent()
        );
        const titles = component.recentlyAddedVod().map((item) => item.title);

        expect(titles).toHaveLength(30);
        expect(titles[0]).toBe('Fresh 1');
        expect(titles.at(-1)).toBe('Fresh 30');
        expect(titles).not.toContain('Fresh 31');
        expect(titles).not.toContain('Future Provider Item');
    });

    it('updates all recently added rails when category visibility changes', () => {
        const visibleLive = createItem(1, { title: 'Visible Live' });
        const hiddenLive = createItem(2, {
            category_id: 20,
            title: 'Hidden Live',
        });
        const visibleVod = createItem(3, { title: 'Visible Movie' });
        const hiddenVod = createItem(4, {
            category_id: 20,
            title: 'Hidden Movie',
        });
        const visibleSeries = createItem(5, { title: 'Visible Series' });
        const hiddenSeries = createItem(6, {
            category_id: 20,
            title: 'Hidden Series',
        });
        store.liveStreams.set([hiddenLive, visibleLive]);
        store.vodStreams.set([hiddenVod, visibleVod]);
        store.serialStreams.set([hiddenSeries, visibleSeries]);
        const visibleCategoryIds = signal([10]);
        const visibleContentByType = jest.fn((type: ContentType) => {
            const visible = (items: TestRecentlyAddedItem[]) =>
                items.filter((item) =>
                    visibleCategoryIds().includes(item.category_id)
                );
            switch (type) {
                case 'live':
                    return visible(store.liveStreams());
                case 'vod':
                    return visible(store.vodStreams());
                case 'series':
                    return visible(store.serialStreams());
            }
        });
        store.getVisibleContentByType.mockReturnValue(visibleContentByType);

        const component = TestBed.runInInjectionContext(
            () => new RecentlyAddedComponent()
        );

        expect(component.recentlyAddedLive().map((item) => item.title)).toEqual(
            ['Visible Live']
        );
        expect(component.recentlyAddedVod().map((item) => item.title)).toEqual([
            'Visible Movie',
        ]);
        expect(
            component.recentlyAddedSeries().map((item) => item.title)
        ).toEqual(['Visible Series']);
        expect(store.getVisibleContentByType).toHaveBeenCalledTimes(1);
        expect(visibleContentByType).toHaveBeenCalledWith('live');
        expect(visibleContentByType).toHaveBeenCalledWith('vod');
        expect(visibleContentByType).toHaveBeenCalledWith('series');

        visibleCategoryIds.set([]);
        expect(component.recentlyAddedLive()).toEqual([]);
        expect(component.recentlyAddedVod()).toEqual([]);
        expect(component.recentlyAddedSeries()).toEqual([]);

        visibleCategoryIds.set([10]);
        expect(component.recentlyAddedLive()).toEqual([visibleLive]);
        expect(component.recentlyAddedVod()).toEqual([visibleVod]);
        expect(component.recentlyAddedSeries()).toEqual([visibleSeries]);
    });

    it('filters invalid provider dates before slicing small VOD rails', () => {
        const futureItem = createItem(999, {
            added: toEpochSeconds('2030-01-01T00:00:00.000Z'),
            title: 'Future Provider Item',
            xtream_id: 999,
        });

        store.vodStreams.set([
            futureItem,
            createItem(1, { title: 'Fresh 1', xtream_id: 1 }),
            createItem(2, { title: 'Fresh 2', xtream_id: 2 }),
        ]);

        const component = TestBed.runInInjectionContext(
            () => new RecentlyAddedComponent()
        );
        const titles = component.recentlyAddedVod().map((item) => item.title);

        expect(titles).toEqual(['Fresh 1', 'Fresh 2']);
    });

    it('uses the series sort timestamp priority for displayed dates', () => {
        const component = TestBed.runInInjectionContext(
            () => new RecentlyAddedComponent()
        );

        expect(
            component.getDate(
                createItem(1, {
                    added: toEpochSeconds('2026-05-01T00:00:00.000Z'),
                    last_modified: toEpochSeconds('2026-05-15T00:00:00.000Z'),
                }),
                true
            )
        ).toBe(Date.parse('2026-05-15T00:00:00.000Z'));
    });

    it('navigates live recently-added cards with auto-open playback state', () => {
        const component = TestBed.runInInjectionContext(
            () => new RecentlyAddedComponent()
        );
        const item = createItem(101, {
            category_id: 7,
            poster_url: 'live-news.png',
            title: 'Live News',
        });

        component.openItem(item, 'live');

        expect(store.setSelectedContentType).toHaveBeenCalledWith('live');
        expect(router.navigate).toHaveBeenCalledWith(['..', 'live', 7], {
            relativeTo: TestBed.inject(ActivatedRoute),
            state: {
                openXtreamLiveItemId: 101,
                openXtreamLiveTitle: 'Live News',
                openXtreamLivePoster: 'live-news.png',
            },
        });
    });
});

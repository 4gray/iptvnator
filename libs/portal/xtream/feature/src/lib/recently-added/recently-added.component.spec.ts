import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
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

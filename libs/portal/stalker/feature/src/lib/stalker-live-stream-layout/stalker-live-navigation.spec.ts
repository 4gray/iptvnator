import { signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LiveLayoutSidebarStateService } from '@iptvnator/portal/shared/util';
import {
    StalkerItvChannel,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { StalkerLiveNavigation } from './stalker-live-navigation';

const channel = (id: string, category = 'news'): StalkerItvChannel => ({
    id,
    name: id,
    cmd: `stream-${id}`,
    tv_genre_id: category,
});

describe('StalkerLiveNavigation', () => {
    let navigation: StalkerLiveNavigation;
    const first = channel('1');
    const second = channel('2');
    const third = channel('3', 'sports');
    const rows = signal([first, second]);
    const loading = signal(false);
    const store = {
        currentPlaylist: signal({ _id: 'source-a' }),
        selectedContentType: signal('itv'),
        selectedCategoryId: signal<string | null>('news'),
        searchPhrase: signal(''),
        selectedItem: signal<StalkerItvChannel | null>(null),
        page: signal(0),
        hasMoreChannels: signal(false),
        getCategoryResource: signal([
            { category_id: 'news' },
            { category_id: 'sports' },
        ]),
        setSearchPhrase: jest.fn((query: string) =>
            store.searchPhrase.set(query)
        ),
        setSelectedCategory: jest.fn((category: string) =>
            store.selectedCategoryId.set(category)
        ),
        setPage: jest.fn((page: number) => store.page.set(page)),
    };
    const router = {
        url: '/workspace/stalker/source-a/itv?q=sport&keep=1',
        parseUrl: jest.fn(() => ({ queryParams: { q: 'sport', keep: '1' } })),
        navigateByUrl: jest.fn().mockResolvedValue(true),
    };
    const sidebar = { setState: jest.fn() };
    const play = jest.fn();
    const revealRow = jest.fn(() => true);

    beforeEach(() => {
        TestBed.configureTestingModule({});
        jest.clearAllMocks();
        rows.set([first, second]);
        loading.set(false);
        store.currentPlaylist.set({ _id: 'source-a' });
        store.selectedContentType.set('itv');
        store.selectedCategoryId.set('news');
        store.searchPhrase.set('');
        store.selectedItem.set(null);
        store.page.set(0);
        store.hasMoreChannels.set(false);
        store.getCategoryResource.set([
            { category_id: 'news' },
            { category_id: 'sports' },
        ]);
        router.navigateByUrl.mockResolvedValue(true);
        navigation = TestBed.runInInjectionContext(
            () =>
                new StalkerLiveNavigation({
                    store: store as unknown as InstanceType<
                        typeof StalkerStore
                    >,
                    router: router as unknown as Router,
                    sidebar:
                        sidebar as unknown as LiveLayoutSidebarStateService,
                    rows: (term) => {
                        const query = term?.() ?? store.searchPhrase();
                        return rows().filter(
                            (row) => !query || row.name?.includes(query)
                        );
                    },
                    loading,
                    play,
                    revealRow,
                })
        );
        TestBed.tick();
    });
    afterEach(() => navigation.reset());

    it('captures resolved selection order and keeps it during category/search browsing', () => {
        const commit = navigation.prepare(first);
        store.selectedCategoryId.set('sports');
        rows.set([third]);
        commit();
        store.searchPhrase.set('3');
        TestBed.tick();
        expect(navigation.channels()).toEqual([first, second]);
        navigation.adjacent('down');
        expect(play).toHaveBeenLastCalledWith(second);
        navigation.selectNumber(1);
        expect(play).toHaveBeenLastCalledWith(first);
        expect(store.selectedCategoryId()).toBe('sports');
    });

    it('does not replace playback navigation for a failed resolution', () => {
        navigation.prepare(first)();
        rows.set([third]);
        navigation.prepare(third); // Rejected resolver never calls the commit.
        navigation.adjacent('down');
        expect(play).toHaveBeenCalledWith(second);
    });

    it('preserves the queue on remote selection and same-channel replay', () => {
        navigation.prepare(first)();
        rows.set([third]);
        navigation.prepare(second, 'preserve')();
        navigation.prepare(second)();
        navigation.selectNumber(1);
        expect(play).toHaveBeenCalledWith(first);
    });

    it('captures the fullscreen filtered list independently of sidebar search', () => {
        store.searchPhrase.set('1');
        rows.set([second, first]);
        navigation.prepare(second, signal(''))();
        expect(navigation.channels()).toEqual([second, first]);
    });

    it('extends only loaded pages of the original category and query', () => {
        navigation.prepare(first)();
        rows.set([first, second, channel('4')]);
        store.page.set(1);
        TestBed.tick();
        expect(navigation.channels().map((item) => item.id)).toEqual([
            '1',
            '2',
            '4',
        ]);
        store.searchPhrase.set('5');
        rows.set([channel('5')]);
        TestBed.tick();
        store.searchPhrase.set('');
        store.selectedCategoryId.set('sports');
        rows.set([third]);
        TestBed.tick();
        expect(navigation.channels().map((item) => item.id)).toEqual([
            '1',
            '2',
            '4',
        ]);
    });

    it('does not append another provider search after a fullscreen capture', () => {
        store.selectedContentType.set('radio');
        TestBed.tick();
        store.searchPhrase.set('1');
        navigation.prepare(first, signal(''))();
        store.searchPhrase.set('3');
        rows.set([third]);
        TestBed.tick();
        expect(navigation.channels()).toEqual([first, second]);
    });

    it('includes same-scope pages that finish while playback resolution is pending', () => {
        const commit = navigation.prepare(first);
        const nextPage = channel('4');
        rows.set([first, second, nextPage]);
        TestBed.tick();
        commit();
        TestBed.tick();
        expect(navigation.channels()).toEqual([first, second, nextPage]);
    });

    it('rejects late commits from a different source or content type and after reset', () => {
        const commit = navigation.prepare(first);
        store.selectedContentType.set('radio');
        commit();
        rows.set([third]);
        TestBed.tick();
        expect(navigation.channels()).toEqual([third]);
        const radioCommit = navigation.prepare(third);
        navigation.reset();
        rows.set([]);
        radioCommit();
        expect(navigation.channels()).toEqual([]);
    });

    it('reveals in the original category, clears only q and never plays', fakeAsync(() => {
        navigation.prepare(first)();
        store.selectedCategoryId.set('sports');
        store.searchPhrase.set('3');
        rows.set([third]);
        expect(navigation.canReveal()).toBe(true);
        loading.set(true);
        void navigation.reveal();
        tick();
        rows.set([first, second]);
        loading.set(false);
        TestBed.tick();
        tick();
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            { queryParams: { keep: '1' } },
            { replaceUrl: true }
        );
        expect(store.selectedCategoryId()).toBe('news');
        expect(store.searchPhrase()).toBe('');
        expect(sidebar.setState).toHaveBeenCalledWith('expanded');
        expect(revealRow).toHaveBeenCalledWith('1');
        expect(play).not.toHaveBeenCalled();
        expect(navigation.canReveal()).toBe(false);
    }));

    it('withholds reveal for removed categories', () => {
        navigation.prepare(first)();
        rows.set([third]);
        store.getCategoryResource.set([{ category_id: 'sports' }]);
        expect(navigation.canReveal()).toBe(false);
    });

    it('cancels reveal if browsing changes while routing is pending', async () => {
        navigation.prepare(first)();
        store.selectedCategoryId.set('sports');
        let resolve!: (value: boolean) => void;
        router.navigateByUrl.mockReturnValue(
            new Promise<boolean>((done) => (resolve = done))
        );
        const pending = navigation.reveal();
        store.selectedCategoryId.set('another');
        resolve(true);
        await pending;
        expect(store.setSelectedCategory).not.toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
    });

    it('reveals the known row beyond loaded pages and deduplicates when it arrives', fakeAsync(() => {
        store.searchPhrase.set('2');
        rows.set([second]);
        navigation.prepare(second)();
        store.selectedCategoryId.set('sports');
        rows.set([third]);
        void navigation.reveal();
        tick();
        rows.set([first]);
        TestBed.tick();
        tick();
        expect(navigation.withRevealedItem(rows())).toEqual([second, first]);
        expect(revealRow).toHaveBeenCalledWith('2');
        rows.set([first, second]);
        expect(navigation.withRevealedItem(rows())).toEqual([first, second]);
        expect(navigation.channels()).toEqual([second]);
        store.selectedCategoryId.set('sports');
        TestBed.tick();
        store.selectedCategoryId.set('news');
        rows.set([first]);
        expect(navigation.withRevealedItem(rows())).toEqual([first]);
    }));

    it('returns within the same route without navigating when q is absent', async () => {
        navigation.prepare(first)();
        store.selectedCategoryId.set('sports');
        router.parseUrl.mockReturnValueOnce({ queryParams: {} } as ReturnType<
            typeof router.parseUrl
        >);
        await navigation.reveal();
        expect(router.navigateByUrl).not.toHaveBeenCalled();
        expect(store.selectedCategoryId()).toBe('news');
    });
});

import { DestroyRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { StalkerItvChannel } from '@iptvnator/portal/stalker/data-access';
import { Subject } from 'rxjs';
import { StalkerLiveAutoOpen } from './stalker-live-auto-open';

const channel = (
    id: string,
    genre: string | number = 7
): StalkerItvChannel => ({
    id,
    name: `Channel ${id}`,
    cmd: `stream-${id}`,
    tv_genre_id: genre,
});

describe('StalkerLiveAutoOpen', () => {
    let autoOpen: StalkerLiveAutoOpen;
    let events: Subject<unknown>;
    const store = {
        currentPlaylist: signal<{ _id?: string } | null>({ _id: 'pl-3' }),
        selectedContentType: signal<string | null>('itv'),
        selectedCategoryId: signal<string | null>(null),
        searchPhrase: signal(''),
        itvFullChannelList: signal<StalkerItvChannel[]>([]),
        itvFullListActive: signal(false),
        itvFullListUnsupported: signal(false),
        preloadItvChannels: jest.fn(() => Promise.resolve()),
        setSearchPhrase: jest.fn((phrase: string) =>
            store.searchPhrase.set(phrase)
        ),
        setSelectedCategory: jest.fn((category: string | null) =>
            store.selectedCategoryId.set(category)
        ),
        setPage: jest.fn(),
    };
    const sidebar = { expand: jest.fn() };
    const play = jest.fn();
    /** Rows on screen for the selected category; a NEW array marks a re-serve. */
    const rows = signal<StalkerItvChannel[]>([]);
    const rowsSettled = signal(true);
    const options = () => ({
        store,
        router: { events } as unknown as Router,
        destroyRef: TestBed.inject(DestroyRef),
        sidebar,
        rows: () => rows(),
        rowsSettled: () => rowsSettled(),
        play,
    });

    function arrive(
        state: Record<string, unknown> = {
            openStalkerLiveItemId: '30',
            openStalkerLivePlaylistId: 'pl-3',
        }
    ): void {
        window.history.replaceState(state, '');
        events.next(new NavigationEnd(1, '/itv', '/itv'));
        TestBed.tick();
    }

    beforeEach(() => {
        jest.clearAllMocks();
        window.history.replaceState({}, '');
        store.currentPlaylist.set({ _id: 'pl-3' });
        store.selectedContentType.set('itv');
        store.selectedCategoryId.set(null);
        store.searchPhrase.set('');
        store.itvFullChannelList.set([]);
        store.itvFullListActive.set(false);
        store.itvFullListUnsupported.set(false);
        store.preloadItvChannels.mockImplementation(() => Promise.resolve());
        rows.set([]);
        rowsSettled.set(true);
        events = new Subject();
        TestBed.configureTestingModule({});
        autoOpen = TestBed.runInInjectionContext(
            () => new StalkerLiveAutoOpen(options())
        );
        TestBed.tick();
    });

    /** The genre's rows arrive: a fresh array holding the channel. */
    function serveRows(...channels: StalkerItvChannel[]): void {
        rows.set([...channels]);
        TestBed.tick();
    }

    afterEach(() => {
        window.history.replaceState({}, '');
    });

    it('reads a handoff that was in history before construction', () => {
        window.history.replaceState(
            { openStalkerLiveItemId: '30', openStalkerLivePlaylistId: 'pl-3' },
            ''
        );
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([channel('30')]);
        store.selectedCategoryId.set('7');
        rows.set([channel('30')]);

        const mounted = TestBed.runInInjectionContext(
            () => new StalkerLiveAutoOpen({ ...options(), router: null })
        );
        TestBed.tick();

        // Genre 7 was already the list on screen: no scope change, play now.
        expect(play).toHaveBeenCalledWith(channel('30'));
        expect(mounted.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
    });

    it('starts the full-list load and plays the channel in its genre once the list is ready', () => {
        arrive();

        expect(store.preloadItvChannels).toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
        expect(autoOpen.pendingItemId()).toBe('30');

        store.itvFullChannelList.set([channel('1', 2), channel('30', 7)]);
        store.itvFullListActive.set(true);
        TestBed.tick();

        expect(store.setSearchPhrase).toHaveBeenCalledWith('');
        expect(store.setSelectedCategory).toHaveBeenCalledWith('7');
        expect(store.setPage).toHaveBeenCalledWith(0);
        expect(sidebar.expand).toHaveBeenCalledWith('portal');
        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
        // Playback waits for genre 7's rows: `navigation.prepare` would
        // otherwise capture the previous genre's rows as the channel order.
        expect(play).not.toHaveBeenCalled();

        serveRows(channel('30', 7), channel('31', 7));

        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('defers even when the old scope (All Items / search) already shows the channel', () => {
        // All Items on screen holds the channel, but those rows are not the
        // genre's list: prepare() would capture the wrong channel order.
        const allItems = [channel('1', 2), channel('30', 7)];
        rows.set(allItems);
        store.itvFullChannelList.set(allItems);
        store.itvFullListActive.set(true);

        arrive();
        expect(store.setSelectedCategory).toHaveBeenCalledWith('7');
        expect(play).not.toHaveBeenCalled();

        serveRows(channel('30', 7));
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('defers when the genre is already selected but a search narrows it', () => {
        store.selectedCategoryId.set('7');
        store.searchPhrase.set('news');
        rows.set([channel('30', 7)]);
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        expect(store.setSearchPhrase).toHaveBeenCalledWith('');
        expect(play).not.toHaveBeenCalled();

        serveRows(channel('30', 7), channel('31', 7));
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('plays with the first page once a legacy-paged genre settles without the row', () => {
        const previous = [channel('9', 2)];
        rows.set(previous);
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);
        rowsSettled.set(false);

        arrive();
        expect(play).not.toHaveBeenCalled();

        // Same (stale) array, loading still settled → keep waiting.
        rowsSettled.set(true);
        TestBed.tick();
        expect(play).not.toHaveBeenCalled();

        // Rows replaced (page 1 of the genre, row on a later page) and settled.
        serveRows(channel('40', 7));
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('lets a newer handoff supersede a channel still waiting for its rows', () => {
        store.itvFullChannelList.set([channel('30', 7), channel('31', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        arrive({
            openStalkerLiveItemId: '31',
            openStalkerLivePlaylistId: 'pl-3',
        });
        serveRows(channel('30', 7), channel('31', 7));

        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith(channel('31', 7));
    });

    it('defers the jump from the All Items grid into the All category list', () => {
        // `null` (All Items grid) and '*' (All category) read different rows,
        // so even a genre-less channel must wait for the re-served list.
        const noGenre = { id: '30', cmd: 'x', name: 'No genre' };
        rows.set([noGenre]);
        store.selectedCategoryId.set(null);
        store.itvFullChannelList.set([noGenre]);
        store.itvFullListActive.set(true);

        arrive();
        expect(store.setSelectedCategory).toHaveBeenCalledWith('*');
        expect(play).not.toHaveBeenCalled();

        serveRows(noGenre);
        expect(play).toHaveBeenCalledWith(noGenre);
    });

    it('drops the deferred play when the user switches portal first', () => {
        // A genre-less channel targets '*', which a fresh portal's reset
        // (selectedCategoryId null) would otherwise look identical to.
        const noGenre = { id: '30', cmd: 'x', name: 'No genre' };
        rows.set([channel('1', 2)]);
        store.selectedCategoryId.set('2');
        store.itvFullChannelList.set([noGenre]);
        store.itvFullListActive.set(true);

        arrive();
        expect(play).not.toHaveBeenCalled();

        store.currentPlaylist.set({ _id: 'pl-9' });
        store.selectedCategoryId.set(null);
        TestBed.tick();
        serveRows(noGenre);

        expect(play).not.toHaveBeenCalled();
    });

    it('drops the deferred play when the user starts a search first', () => {
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        store.setSearchPhrase('sport');
        TestBed.tick();
        serveRows(channel('30', 7));

        expect(play).not.toHaveBeenCalled();
    });

    it('drops the deferred play when the user selects another genre first', () => {
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        store.setSelectedCategory('2');
        TestBed.tick();
        serveRows(channel('30', 7));

        expect(play).not.toHaveBeenCalled();
    });

    it('falls back to the remembered genre when the full-list load fails transiently', async () => {
        // The cache resolves the preload without turning ready or unsupported
        // (it only arms a retry cooldown), so nothing reactive would ever
        // re-run the effect.
        let settle!: () => void;
        store.preloadItvChannels.mockImplementation(
            () => new Promise<void>((resolve) => (settle = resolve))
        );

        arrive({
            openStalkerLiveItemId: '30',
            openStalkerLivePlaylistId: 'pl-3',
            openStalkerLiveCategoryId: '5',
        });
        expect(autoOpen.pendingItemId()).toBe('30');

        settle();
        await Promise.resolve();
        await Promise.resolve();

        expect(store.setSelectedCategory).toHaveBeenCalledWith('5');
        expect(play).not.toHaveBeenCalled();
        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
    });

    it('retires the transient fallback when the layout is destroyed mid-load', async () => {
        let settle!: () => void;
        store.preloadItvChannels.mockImplementation(
            () => new Promise<void>((resolve) => (settle = resolve))
        );
        let destroy: (() => void) | undefined;
        const destroyRef = {
            onDestroy: (callback: () => void) => {
                destroy = callback;
                return () => undefined;
            },
        } as unknown as DestroyRef;
        window.history.replaceState(
            {
                openStalkerLiveItemId: '30',
                openStalkerLivePlaylistId: 'pl-3',
                openStalkerLiveCategoryId: '5',
            },
            ''
        );
        const mounted = TestBed.runInInjectionContext(
            () =>
                new StalkerLiveAutoOpen({
                    ...options(),
                    router: null,
                    destroyRef,
                })
        );
        TestBed.tick();
        expect(mounted.pendingItemId()).toBe('30');

        destroy?.();
        settle();
        await Promise.resolve();
        await Promise.resolve();

        expect(store.setSelectedCategory).not.toHaveBeenCalled();
        expect(mounted.pendingItemId()).toBeNull();
        // History belongs to the page the user navigated to: left untouched.
        expect(window.history.state.openStalkerLiveItemId).toBe('30');
    });

    it('lets a load that turns ready win over its own settled promise', async () => {
        let settle!: () => void;
        store.preloadItvChannels.mockImplementation(
            () => new Promise<void>((resolve) => (settle = resolve))
        );

        arrive();
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);
        TestBed.tick();
        serveRows(channel('30', 7));
        expect(play).toHaveBeenCalledTimes(1);

        settle();
        await Promise.resolve();
        await Promise.resolve();

        expect(store.setSelectedCategory).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('waits while the store still serves another portal, even one holding the same id', () => {
        store.currentPlaylist.set({ _id: 'pl-1' });
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([channel('30', 9)]);

        arrive();

        expect(play).not.toHaveBeenCalled();
        expect(store.preloadItvChannels).not.toHaveBeenCalled();
        expect(autoOpen.pendingItemId()).toBe('30');

        store.currentPlaylist.set({ _id: 'pl-3' });
        store.itvFullChannelList.set([channel('30', 7)]);
        TestBed.tick();
        serveRows(channel('30', 7));

        expect(play).toHaveBeenCalledWith(channel('30', 7));
        expect(store.setSelectedCategory).toHaveBeenCalledWith('7');
    });

    it('does nothing outside the ITV section', () => {
        store.selectedContentType.set('radio');
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([channel('30')]);

        arrive();

        expect(play).not.toHaveBeenCalled();
        expect(autoOpen.pendingItemId()).toBe('30');
    });

    it('falls back to the remembered category when the portal has no full list', () => {
        store.itvFullListUnsupported.set(true);

        arrive({
            openStalkerLiveItemId: '30',
            openStalkerLivePlaylistId: 'pl-3',
            openStalkerLiveCategoryId: '5',
        });

        expect(play).not.toHaveBeenCalled();
        expect(store.setSelectedCategory).toHaveBeenCalledWith('5');
        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
    });

    it('consumes a handoff whose channel is missing from the loaded list', () => {
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([channel('1')]);

        arrive();

        expect(play).not.toHaveBeenCalled();
        expect(store.setSelectedCategory).not.toHaveBeenCalled();
        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
    });

    it.each([
        { label: 'missing', genre: undefined },
        { label: 'blank', genre: ' ' },
    ])(
        'opens the All pseudo-category for a channel with a $label genre',
        ({ genre }) => {
            const noGenre = {
                id: '30',
                cmd: 'x',
                name: 'No genre',
                tv_genre_id: genre,
            };
            store.itvFullListActive.set(true);
            store.itvFullChannelList.set([noGenre]);

            arrive();
            serveRows(noGenre);

            expect(store.setSelectedCategory).toHaveBeenCalledWith('*');
            expect(play).toHaveBeenCalledWith(noGenre);
        }
    );
});

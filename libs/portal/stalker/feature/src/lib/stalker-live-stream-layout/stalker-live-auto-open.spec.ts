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
        itvChannelsCategory: signal<string | null>(null),
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
    const routeReady = signal(true);
    const options = () => ({
        store,
        router: { events } as unknown as Router,
        destroyRef: TestBed.inject(DestroyRef),
        sidebar,
        routeReady: () => routeReady(),
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
        store.itvChannelsCategory.set(null);
        store.searchPhrase.set('');
        store.itvFullChannelList.set([]);
        store.itvFullListActive.set(false);
        store.itvFullListUnsupported.set(false);
        store.preloadItvChannels.mockImplementation(() => Promise.resolve());
        routeReady.set(true);
        events = new Subject();
        TestBed.configureTestingModule({});
        autoOpen = TestBed.runInInjectionContext(
            () => new StalkerLiveAutoOpen(options())
        );
        TestBed.tick();
    });

    /** The store serves the selected genre's channels (a tick later). */
    function serveCategory(category: string): void {
        store.itvChannelsCategory.set(category);
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
        store.itvChannelsCategory.set('7');

        const mounted = TestBed.runInInjectionContext(
            () => new StalkerLiveAutoOpen({ ...options(), router: null })
        );
        TestBed.tick();

        // Genre 7's channels were already on screen: play at once.
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
        // Playback waits for genre 7's channels: `navigation.prepare` would
        // otherwise capture the previous scope's rows as the channel order.
        expect(play).not.toHaveBeenCalled();

        serveCategory('7');

        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('defers while another genre is still on screen, even when it shows the channel', () => {
        // The All list on screen holds the channel, but those rows are not
        // genre 7's: prepare() would capture the wrong channel order.
        const allItems = [channel('1', 2), channel('30', 7)];
        store.selectedCategoryId.set('*');
        store.itvChannelsCategory.set('*');
        store.itvFullChannelList.set(allItems);
        store.itvFullListActive.set(true);

        arrive();
        expect(store.setSelectedCategory).toHaveBeenCalledWith('7');
        expect(play).not.toHaveBeenCalled();

        serveCategory('7');
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('plays at once when a search narrows the genre already on screen', () => {
        // Clearing the search re-derives the rendered rows synchronously,
        // and the source list is already genre 7's.
        store.selectedCategoryId.set('7');
        store.itvChannelsCategory.set('7');
        store.searchPhrase.set('news');
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();

        expect(store.setSearchPhrase).toHaveBeenCalledWith('');
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('plays once a legacy-paged genre is served, even without the row on page 1', () => {
        store.selectedCategoryId.set('2');
        store.itvChannelsCategory.set('2');
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        expect(play).not.toHaveBeenCalled();

        serveCategory('7');
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('keeps waiting while the previous genre is still the served list', () => {
        store.selectedCategoryId.set('2');
        store.itvChannelsCategory.set('2');
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        TestBed.tick();

        expect(play).not.toHaveBeenCalled();
    });

    it('lets a newer handoff supersede a channel still waiting for its rows', () => {
        store.itvFullChannelList.set([channel('30', 7), channel('31', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        arrive({
            openStalkerLiveItemId: '31',
            openStalkerLivePlaylistId: 'pl-3',
        });
        serveCategory('7');

        expect(play).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledWith(channel('31', 7));
    });

    it('defers the jump from the All Items grid into the All category list', () => {
        // The grid (`selectedCategoryId` null) is not a served category, so
        // even a genre-less channel waits for the '*' list.
        const noGenre = { id: '30', cmd: 'x', name: 'No genre' };
        store.selectedCategoryId.set(null);
        store.itvFullChannelList.set([noGenre]);
        store.itvFullListActive.set(true);

        arrive();
        expect(store.setSelectedCategory).toHaveBeenCalledWith('*');
        expect(play).not.toHaveBeenCalled();

        serveCategory('*');
        expect(play).toHaveBeenCalledWith(noGenre);
    });

    it('drops the deferred play when the user switches portal first', () => {
        // A genre-less channel targets '*', which a fresh portal's reset
        // (selectedCategoryId null) would otherwise look identical to.
        const noGenre = { id: '30', cmd: 'x', name: 'No genre' };
        store.selectedCategoryId.set('2');
        store.itvChannelsCategory.set('2');
        store.itvFullChannelList.set([noGenre]);
        store.itvFullListActive.set(true);

        arrive();
        expect(play).not.toHaveBeenCalled();

        store.currentPlaylist.set({ _id: 'pl-9' });
        store.selectedCategoryId.set('*');
        TestBed.tick();
        serveCategory('*');

        expect(play).not.toHaveBeenCalled();
    });

    it('drops the deferred play when the user starts a search first', () => {
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        store.setSearchPhrase('sport');
        TestBed.tick();
        serveCategory('7');

        expect(play).not.toHaveBeenCalled();
    });

    it('drops the deferred play when the user selects another genre first', () => {
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        store.setSelectedCategory('2');
        TestBed.tick();
        serveCategory('7');

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
        serveCategory('7');
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
        serveCategory('7');

        expect(play).toHaveBeenCalledWith(channel('30', 7));
        expect(store.setSelectedCategory).toHaveBeenCalledWith('7');
    });

    it('matches a cached channel whose blank id sits beside its stream_id', () => {
        const byStreamId = {
            id: '',
            stream_id: 30,
            cmd: 'x',
            name: 'Stream id only',
            tv_genre_id: 7,
        } as unknown as StalkerItvChannel;
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([byStreamId]);

        arrive();
        serveCategory('7');

        expect(play).toHaveBeenCalledWith(byStreamId);
    });

    it('waits for the route session before touching the store', () => {
        // Revisiting a portal keeps its playlist and cache, so the playlist
        // check passes at once — but the session's own reset would wipe the
        // selection a tick later.
        routeReady.set(false);
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([channel('30', 7)]);

        arrive();

        expect(store.setSelectedCategory).not.toHaveBeenCalled();
        expect(store.preloadItvChannels).not.toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
        expect(autoOpen.pendingItemId()).toBe('30');

        routeReady.set(true);
        TestBed.tick();
        serveCategory('7');

        expect(store.setSelectedCategory).toHaveBeenCalledWith('7');
        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('drops the handoff when the user picks another genre while the list loads', () => {
        let settle!: () => void;
        store.preloadItvChannels.mockImplementation(
            () => new Promise<void>((resolve) => (settle = resolve))
        );

        arrive();
        expect(autoOpen.pendingItemId()).toBe('30');

        // The user moved on before the full list arrived.
        store.selectedCategoryId.set('2');
        TestBed.tick();

        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});

        settle();
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);
        TestBed.tick();

        expect(play).not.toHaveBeenCalled();
        expect(store.setSelectedCategory).not.toHaveBeenCalledWith('7');
    });

    it('drops the handoff when the user starts searching while the list loads', () => {
        store.preloadItvChannels.mockImplementation(
            () => new Promise(() => undefined)
        );

        arrive();
        expect(autoOpen.pendingItemId()).toBe('30');

        store.searchPhrase.set('sport');
        TestBed.tick();

        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
    });

    it("does not read the route session's own reset as the user moving on", () => {
        // The session clears the category for the arrival; that is not a
        // user action and must not drop the handoff.
        routeReady.set(false);
        store.selectedCategoryId.set('4');
        store.itvFullChannelList.set([channel('30', 7)]);
        store.itvFullListActive.set(true);

        arrive();
        store.selectedCategoryId.set(null);
        routeReady.set(true);
        TestBed.tick();
        serveCategory('7');

        expect(play).toHaveBeenCalledWith(channel('30', 7));
    });

    it('opens the All list for a cached row whose genre the cache cannot filter', () => {
        // `filterItvChannelsByGenre` mirrors the portal's `genre=` filter,
        // i.e. `tv_genre_id`: a row carrying only `category_id` is absent
        // from that genre's cached slice, so selecting it would strand the
        // channel behind a paged request. The All list always holds it.
        const byCategoryId = {
            id: '30',
            cmd: 'x',
            name: 'Category id only',
            category_id: '8',
        } as unknown as StalkerItvChannel;
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([byCategoryId]);

        arrive();
        serveCategory('*');

        expect(store.setSelectedCategory).toHaveBeenCalledWith('*');
        expect(play).toHaveBeenCalledWith(byCategoryId);
    });

    it('finds a channel persisted under its stream_id while the cache keys it by id', () => {
        // A favorite stores `stream_id ?? id`, a cached channel keeps
        // `id ?? stream_id` — a row with two different ids must still match.
        const twoIds = {
            id: '5',
            stream_id: '99',
            cmd: 'x',
            name: 'Two ids',
            tv_genre_id: 7,
        } as unknown as StalkerItvChannel;
        const other = channel('7', 7);
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([other, twoIds]);

        arrive({
            openStalkerLiveItemId: '99',
            openStalkerLivePlaylistId: 'pl-3',
        });
        serveCategory('7');

        expect(play).toHaveBeenCalledWith(twoIds);
    });

    it('plays nothing when two channels claim the handoff id under different fields', () => {
        // The handoff carries a bare value and cannot say which field it came
        // from, so an ambiguous identity must not gamble on playback; the
        // remembered genre still opens.
        const byId = {
            id: '99',
            cmd: 'x',
            name: 'By id',
            tv_genre_id: 7,
        } as unknown as StalkerItvChannel;
        const byStreamId = {
            id: '5',
            stream_id: '99',
            cmd: 'x',
            name: 'By stream id',
            tv_genre_id: 7,
        } as unknown as StalkerItvChannel;
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([byStreamId, byId]);

        arrive({
            openStalkerLiveItemId: '99',
            openStalkerLivePlaylistId: 'pl-3',
            openStalkerLiveCategoryId: '4',
        });

        expect(play).not.toHaveBeenCalled();
        expect(store.setSelectedCategory).toHaveBeenCalledWith('4');
        expect(autoOpen.pendingItemId()).toBeNull();
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
            serveCategory('*');

            expect(store.setSelectedCategory).toHaveBeenCalledWith('*');
            expect(play).toHaveBeenCalledWith(noGenre);
        }
    );
});

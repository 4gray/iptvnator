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
        itvFullChannelList: signal<StalkerItvChannel[]>([]),
        itvFullListActive: signal(false),
        itvFullListUnsupported: signal(false),
        preloadItvChannels: jest.fn(),
        setSearchPhrase: jest.fn(),
        setSelectedCategory: jest.fn(),
        setPage: jest.fn(),
    };
    const sidebar = { expand: jest.fn() };
    const play = jest.fn();

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
        store.itvFullChannelList.set([]);
        store.itvFullListActive.set(false);
        store.itvFullListUnsupported.set(false);
        events = new Subject();
        TestBed.configureTestingModule({});
        autoOpen = TestBed.runInInjectionContext(
            () =>
                new StalkerLiveAutoOpen({
                    store,
                    router: { events } as unknown as Router,
                    destroyRef: TestBed.inject(DestroyRef),
                    sidebar,
                    play,
                })
        );
        TestBed.tick();
    });

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

        const mounted = TestBed.runInInjectionContext(
            () =>
                new StalkerLiveAutoOpen({
                    store,
                    router: null,
                    destroyRef: TestBed.inject(DestroyRef),
                    play,
                })
        );
        TestBed.tick();

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
        expect(play).toHaveBeenCalledWith(channel('30', 7));
        expect(autoOpen.pendingItemId()).toBeNull();
        expect(window.history.state).toEqual({});
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

    it('opens the All pseudo-category for a channel without a genre', () => {
        store.itvFullListActive.set(true);
        store.itvFullChannelList.set([
            { id: '30', cmd: 'x', name: 'No genre' },
        ]);

        arrive();

        expect(store.setSelectedCategory).toHaveBeenCalledWith('*');
        expect(play).toHaveBeenCalled();
    });
});

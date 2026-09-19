import {
    DestroyRef,
    effect,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
    normalizeStalkerEntityId,
    StalkerItvChannel,
} from '@iptvnator/portal/stalker/data-access';
import {
    OPEN_STALKER_LIVE_CATEGORY_STATE_KEY,
    OPEN_STALKER_LIVE_ITEM_STATE_KEY,
    OPEN_STALKER_LIVE_PLAYLIST_STATE_KEY,
    OPEN_STALKER_LIVE_POSTER_STATE_KEY,
    OPEN_STALKER_LIVE_TITLE_STATE_KEY,
} from '@iptvnator/portal/shared/util';

/** The slice of `StalkerStore` the auto-open flow reads and drives. */
export interface StalkerLiveAutoOpenStore {
    currentPlaylist: Signal<{ _id?: string } | null | undefined>;
    selectedContentType: Signal<string | null | undefined>;
    itvFullChannelList: Signal<StalkerItvChannel[]>;
    itvFullListActive: Signal<boolean>;
    itvFullListUnsupported: Signal<boolean>;
    preloadItvChannels(): void;
    setSearchPhrase(phrase: string): void;
    setSelectedCategory(category: string | null): void;
    setPage(page: number): void;
}

export interface StalkerLiveAutoOpenOptions {
    store: StalkerLiveAutoOpenStore;
    router: Router | null;
    destroyRef: DestroyRef;
    sidebar?: { expand(surface: 'portal'): void };
    play: (item: StalkerItvChannel) => void;
}

/**
 * Opens the channel named in the arrival's history state
 * (`openStalkerLiveItemId`, written by `buildStalkerLiveNavigationTarget`)
 * inside the ITV layout — the Stalker counterpart of Xtream's
 * `LiveStreamAutoOpenStateService` + effect.
 *
 * The state is read once at construction and again on every NavigationEnd:
 * a cross-route arrival may activate this component after or before that
 * event depending on the shell, and a playlist switch reuses it. The pending
 * item is scoped to its playlist (`openStalkerLivePlaylistId`): the shared
 * store may still serve the previous portal, and channel ids are
 * provider-local, so nothing is matched until `currentPlaylist` is the
 * requested one.
 *
 * Location goes through the full ITV channel list cache (the same list the
 * count badges and search use), because `get_ordered_list` is server-paged
 * and the channel may sit on any page of its genre. While that list loads the
 * effect waits (it re-runs when the cache turns ready). A portal that cannot
 * provide the list, or a channel missing from it (censored genres are
 * excluded from `get_all_channels`), falls back to selecting the category the
 * collection row remembered, when it did, so the user lands in the right list
 * even though the row cannot be picked; then the handoff is consumed.
 */
export class StalkerLiveAutoOpen {
    readonly pendingItemId = signal<string | null>(null);
    readonly pendingPlaylistId = signal<string | null>(null);
    readonly pendingCategoryId = signal<string | null>(null);

    constructor(private readonly options: StalkerLiveAutoOpenOptions) {
        this.captureFromHistoryState();
        options.router?.events
            ?.pipe(
                filter((event) => event instanceof NavigationEnd),
                takeUntilDestroyed(options.destroyRef)
            )
            .subscribe(() => this.captureFromHistoryState());

        effect(() => this.run());
    }

    captureFromHistoryState(): void {
        const state = (window.history.state ?? null) as Record<
            string,
            unknown
        > | null;
        const itemId = normalizeStalkerEntityId(
            state?.[OPEN_STALKER_LIVE_ITEM_STATE_KEY]
        );
        if (!itemId) {
            this.clearPendingItem();
            return;
        }

        this.pendingPlaylistId.set(
            normalizeStalkerEntityId(
                state?.[OPEN_STALKER_LIVE_PLAYLIST_STATE_KEY]
            ) || null
        );
        this.pendingCategoryId.set(
            normalizeStalkerEntityId(
                state?.[OPEN_STALKER_LIVE_CATEGORY_STATE_KEY]
            ) || null
        );
        this.pendingItemId.set(itemId);
    }

    clearPendingItem(): void {
        this.pendingItemId.set(null);
        this.pendingPlaylistId.set(null);
        this.pendingCategoryId.set(null);
    }

    clearHistoryState(): void {
        try {
            const state = (window.history.state ?? {}) as Record<
                string,
                unknown
            >;
            if (!(OPEN_STALKER_LIVE_ITEM_STATE_KEY in state)) {
                return;
            }

            const nextState = { ...state };
            delete nextState[OPEN_STALKER_LIVE_ITEM_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_PLAYLIST_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_CATEGORY_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_TITLE_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_POSTER_STATE_KEY];
            window.history.replaceState(nextState, document.title);
        } catch {
            // Browser history state can be unavailable in restricted contexts.
        }
    }

    private run(): void {
        const pendingId = this.pendingItemId();
        if (!pendingId) {
            return;
        }

        const { store } = this.options;
        if (store.selectedContentType() !== 'itv') {
            return;
        }

        const playlist = store.currentPlaylist();
        const pendingPlaylistId = this.pendingPlaylistId();
        if (
            !playlist ||
            (pendingPlaylistId &&
                normalizeStalkerEntityId(playlist._id) !== pendingPlaylistId)
        ) {
            return;
        }

        if (store.itvFullListUnsupported()) {
            untracked(() => this.settle(null));
            return;
        }

        if (!store.itvFullListActive()) {
            // Idempotent: the layout's own preload effect may already have
            // started it, and the cache de-duplicates in-flight loads.
            untracked(() => store.preloadItvChannels());
            return;
        }

        const item =
            store
                .itvFullChannelList()
                .find(
                    (channel) =>
                        normalizeStalkerEntityId(channel.id) === pendingId
                ) ?? null;
        untracked(() => this.settle(item));
    }

    private settle(item: StalkerItvChannel | null): void {
        const { store } = this.options;
        const category = item
            ? item.tv_genre_id != null
                ? String(item.tv_genre_id)
                : '*'
            : this.pendingCategoryId();

        if (category) {
            store.setSearchPhrase('');
            store.setSelectedCategory(category);
            store.setPage(0);
            this.options.sidebar?.expand('portal');
        }
        if (item) {
            this.options.play(item);
        }

        this.clearPendingItem();
        this.clearHistoryState();
    }
}

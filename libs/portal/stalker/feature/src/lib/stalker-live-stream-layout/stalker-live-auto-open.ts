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
    selectedCategoryId: Signal<string | null | undefined>;
    searchPhrase: Signal<string>;
    itvFullChannelList: Signal<StalkerItvChannel[]>;
    itvFullListActive: Signal<boolean>;
    itvFullListUnsupported: Signal<boolean>;
    /** Resolves when the full-list load settles (also when it fails). */
    preloadItvChannels(): Promise<void> | void;
    setSearchPhrase(phrase: string): void;
    setSelectedCategory(category: string | null): void;
    setPage(page: number): void;
}

export interface StalkerLiveAutoOpenOptions {
    store: StalkerLiveAutoOpenStore;
    router: Router | null;
    destroyRef: DestroyRef;
    sidebar?: { expand(surface: 'portal'): void };
    /** The channel rows currently on screen for the selected category. */
    rows: () => readonly StalkerItvChannel[];
    /** True while no category page or full-list load is in flight. */
    rowsSettled: () => boolean;
    play: (item: StalkerItvChannel) => void;
}

interface DeferredPlay {
    item: StalkerItvChannel;
    category: string;
    /** The rows on screen when the category was switched — the OLD list. */
    staleRows: readonly StalkerItvChannel[];
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
 * even though the row cannot be picked; then the handoff is consumed. A load
 * that fails transiently (the cache only arms a retry cooldown, no signal
 * changes) resolves the same way: the preload promise settles, the list is
 * neither ready nor unsupported, and the genre fallback runs instead of
 * leaving the handoff pending forever.
 *
 * Playback is deferred whenever selecting the genre changes the list scope
 * (another genre, All Items, or an active search): `playChannel` →
 * `navigation.prepare` captures the displayed rows as the remote/numeric
 * channel order, and right after `setSelectedCategory` those are still the
 * previous scope's — even when they happen to contain the channel. The
 * deferred play fires once the rows were re-served for the genre and either
 * hold the channel or loading settled (a legacy-paged genre whose first page
 * lacks it). Selecting another genre or section, or a newer handoff, drops it.
 */
export class StalkerLiveAutoOpen {
    readonly pendingItemId = signal<string | null>(null);
    readonly pendingPlaylistId = signal<string | null>(null);
    readonly pendingCategoryId = signal<string | null>(null);
    private readonly deferredPlay = signal<DeferredPlay | null>(null);
    /** Bumped whenever the pending item changes, to retire a stale preload. */
    private generation = 0;

    constructor(private readonly options: StalkerLiveAutoOpenOptions) {
        this.captureFromHistoryState();
        options.router?.events
            ?.pipe(
                filter((event) => event instanceof NavigationEnd),
                takeUntilDestroyed(options.destroyRef)
            )
            .subscribe(() => this.captureFromHistoryState());

        effect(() => this.run());
        effect(() => this.runDeferredPlay());
        // A preload promise can settle after the layout is gone; retire the
        // handoff so its fallback cannot touch the store or history state of
        // whatever page the user navigated to.
        options.destroyRef.onDestroy(() => {
            this.clearPendingItem();
            this.deferredPlay.set(null);
        });
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
        this.generation += 1;
        // A newer handoff supersedes a channel still waiting for its genre's
        // rows; otherwise the old one would play once they settle.
        this.deferredPlay.set(null);
        this.pendingItemId.set(itemId);
    }

    clearPendingItem(): void {
        this.generation += 1;
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
            // started it, and the cache de-duplicates in-flight loads. When
            // the load settles without the list turning ready or unsupported
            // it failed transiently — fall back to the genre rather than wait
            // for a retry nothing schedules.
            const generation = this.generation;
            untracked(() => {
                void Promise.resolve(store.preloadItvChannels()).then(() => {
                    if (
                        generation !== this.generation ||
                        !this.pendingItemId() ||
                        store.itvFullListActive() ||
                        store.itvFullListUnsupported()
                    ) {
                        return;
                    }
                    this.settle(null);
                });
            });
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
        // A blank genre (`''`, whitespace) is as absent as a missing one.
        const category = item
            ? normalizeStalkerEntityId(item.tv_genre_id) || '*'
            : this.pendingCategoryId();

        const staleRows = this.options.rows();
        const scopeChanged =
            !!category &&
            ((store.selectedCategoryId() ?? '*') !== category ||
                store.searchPhrase().trim() !== '');
        if (category) {
            store.setSearchPhrase('');
            store.setSelectedCategory(category);
            store.setPage(0);
            this.options.sidebar?.expand('portal');
        }
        if (item) {
            if (scopeChanged) {
                this.deferredPlay.set({ item, category, staleRows });
            } else {
                this.options.play(item);
            }
        }

        this.clearPendingItem();
        this.clearHistoryState();
    }

    private runDeferredPlay(): void {
        const deferred = this.deferredPlay();
        if (!deferred) {
            return;
        }

        const { store } = this.options;
        if (
            store.selectedContentType() !== 'itv' ||
            (store.selectedCategoryId() ?? '*') !== deferred.category
        ) {
            // The user moved on before the genre's rows arrived.
            untracked(() => this.deferredPlay.set(null));
            return;
        }

        // The old scope's rows may already contain the channel; only a
        // re-served list belongs to the genre.
        const rows = this.options.rows();
        const ready =
            rows !== deferred.staleRows &&
            (this.containsChannel(rows, deferred.item) ||
                this.options.rowsSettled());
        if (!ready) {
            return;
        }

        untracked(() => {
            this.deferredPlay.set(null);
            this.options.play(deferred.item);
        });
    }

    private containsChannel(
        rows: readonly StalkerItvChannel[],
        item: StalkerItvChannel
    ): boolean {
        const id = normalizeStalkerEntityId(item.id);
        return rows.some((row) => normalizeStalkerEntityId(row.id) === id);
    }
}

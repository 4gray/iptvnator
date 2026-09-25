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
import { StalkerLiveAutoOpenState } from './stalker-live-auto-open-state';

/** The slice of `StalkerStore` the auto-open flow reads and drives. */
export interface StalkerLiveAutoOpenStore {
    currentPlaylist: Signal<{ _id?: string } | null | undefined>;
    selectedContentType: Signal<string | null | undefined>;
    selectedCategoryId: Signal<string | null | undefined>;
    /** The category the channels on screen were served for (see the store). */
    itvChannelsCategory: Signal<string | null>;
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
    /**
     * False while the route session is still applying the route to the store
     * (`StalkerWorkspaceRouteSession.isReady`). Defaults to ready when no
     * session is provided.
     */
    routeReady?: () => boolean;
    play: (item: StalkerItvChannel) => void;
}

interface DeferredPlay {
    item: StalkerItvChannel;
    /** The portal the channel belongs to; a portal switch drops the request. */
    playlistId: string;
    /** The genre whose channels must be on screen before playback starts. */
    category: string;
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
 * Playback waits until the channels on screen are the genre's: `playChannel`
 * → `navigation.prepare` captures the displayed rows as the remote/numeric
 * channel order, and the store serves a category a tick after
 * `setSelectedCategory` — even from the full-list cache — so playing right
 * away would capture the previous scope's queue. The store answers "whose
 * channels are these?" with `itvChannelsCategory`; array identity cannot,
 * because filtering by `'*'` hands back the cache by reference and clearing
 * a search replaces the rendered list without the source moving. Clearing
 * the search IS synchronous, so a genre already on screen plays at once. A
 * newer handoff, a portal/section/genre switch or a fresh search drops a
 * pending play.
 *
 * Two things must settle before any of that: the route session, which resets
 * the selected category and item on arrival and would wipe a selection made
 * ahead of it (the store keeps the previous portal's playlist and cache
 * across a revisit, so the playlist check alone passes too early), and the
 * user, who may pick another genre or start searching while the full list
 * loads — measured against the list state captured once the handoff became
 * actionable, so the session's own resets never read as a user action.
 */
export class StalkerLiveAutoOpen {
    private readonly state = new StalkerLiveAutoOpenState();
    readonly pendingItemId = this.state.pendingItemId;
    readonly pendingPlaylistId = this.state.pendingPlaylistId;
    readonly pendingCategoryId = this.state.pendingCategoryId;
    private readonly deferredPlay = signal<DeferredPlay | null>(null);
    /** The list state when the handoff became actionable (see the class). */
    private pendingBaseline: {
        category: string | null;
        search: string;
    } | null = null;

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
        this.state.captureFromHistoryState();
        // Whatever the previous handoff started is retired either way: a
        // newer one supersedes a channel still waiting for its genre's rows,
        // and an arrival without a handoff has nothing to continue.
        this.deferredPlay.set(null);
        this.pendingBaseline = null;
    }

    clearPendingItem(): void {
        this.pendingBaseline = null;
        this.state.clearPendingItem();
    }

    clearHistoryState(): void {
        this.state.clearHistoryState();
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

        // The route session resets the selected category and item for this
        // arrival; settling first would be undone a tick later.
        if (!(this.options.routeReady?.() ?? true)) {
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

        // The user owns the list once the handoff is actionable: picking
        // another genre or starting a search means they moved on, and the
        // channel must not hijack the view when the full list finally lands.
        if (!this.pendingBaseline) {
            this.pendingBaseline = {
                category: store.selectedCategoryId() ?? null,
                search: store.searchPhrase().trim(),
            };
        } else if (!this.handoffStillOwnsTheList()) {
            untracked(() => {
                this.clearPendingItem();
                this.clearHistoryState();
            });
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
            const generation = this.state.generation;
            untracked(() => {
                void Promise.resolve(store.preloadItvChannels()).then(() => {
                    // The promise can settle before the effect that would
                    // abandon a handoff the user walked away from, so the
                    // user's own state is rechecked here too.
                    if (
                        generation !== this.state.generation ||
                        !this.pendingItemId() ||
                        store.itvFullListActive() ||
                        store.itvFullListUnsupported() ||
                        !this.handoffStillOwnsTheList()
                    ) {
                        return;
                    }
                    this.settle(null);
                });
            });
            return;
        }

        // Either provider id can be the one that was persisted: a favorite
        // prefers `stream_id` (`with-stalker-favorites.feature.ts`) while a
        // cached channel prefers `id`, both skipping blanks, so a row
        // carrying two different non-blank ids is reachable only by
        // accepting both.
        // The handoff carries a bare value, so it cannot say WHICH field it
        // came from: when one channel claims it as its id and another as its
        // stream id, the identity is ambiguous and neither is played —
        // guessing an order would open the wrong channel half the time. The
        // genre fallback still runs, so the user lands in the right list.
        const candidates = store
            .itvFullChannelList()
            .filter(
                (channel) =>
                    normalizeStalkerEntityId(channel.id) === pendingId ||
                    normalizeStalkerEntityId(channel.stream_id) === pendingId
            );
        untracked(() =>
            this.settle(candidates.length === 1 ? candidates[0] : null)
        );
    }

    private settle(item: StalkerItvChannel | null): void {
        const { store } = this.options;
        // A located row is played FROM THE CACHE, and the cached list is
        // filtered by `tv_genre_id` alone — `filterItvChannelsByGenre`
        // deliberately mirrors the portal's own `genre=` filter. Selecting a
        // genre that filter cannot serve (a row carrying only `category_id`)
        // would strand the channel behind a paged request that may not
        // answer, so the All list, which always holds it, is the honest
        // destination. A blank genre (`''`, whitespace) is as absent as a
        // missing one. The remembered genre for a row that could NOT be
        // located is a different case: it is served by the portal, so it
        // does read `category_id` (`resolveStalkerLiveGenreId`).
        const category = item
            ? normalizeStalkerEntityId(item.tv_genre_id) || '*'
            : this.pendingCategoryId();

        if (category) {
            store.setSearchPhrase('');
            store.setSelectedCategory(category);
            store.setPage(0);
            this.options.sidebar?.expand('portal');
        }
        if (item && category) {
            if (store.itvChannelsCategory() === category) {
                this.options.play(item);
            } else {
                this.deferredPlay.set({
                    item,
                    playlistId: normalizeStalkerEntityId(
                        store.currentPlaylist()?._id
                    ),
                    category,
                });
            }
        }

        this.clearPendingItem();
        this.clearHistoryState();
    }

    /**
     * Whether the handoff still describes what the user is looking at: the
     * requested portal, the ITV section, and the genre and search it
     * captured once it became actionable.
     */
    private handoffStillOwnsTheList(): boolean {
        const { store } = this.options;
        if (store.selectedContentType() !== 'itv') {
            return false;
        }

        const playlist = store.currentPlaylist();
        const pendingPlaylistId = this.pendingPlaylistId();
        if (
            !playlist ||
            (pendingPlaylistId &&
                normalizeStalkerEntityId(playlist._id) !== pendingPlaylistId)
        ) {
            return false;
        }

        const baseline = this.pendingBaseline;
        return (
            !baseline ||
            (baseline.category === (store.selectedCategoryId() ?? null) &&
                baseline.search === store.searchPhrase().trim())
        );
    }

    private runDeferredPlay(): void {
        const deferred = this.deferredPlay();
        if (!deferred) {
            return;
        }

        const { store } = this.options;
        if (
            normalizeStalkerEntityId(store.currentPlaylist()?._id) !==
                deferred.playlistId ||
            store.selectedContentType() !== 'itv' ||
            store.selectedCategoryId() !== deferred.category ||
            store.searchPhrase().trim() !== ''
        ) {
            // The user moved on (another portal, genre or section, or
            // started a search) before the genre's rows arrived.
            untracked(() => this.deferredPlay.set(null));
            return;
        }

        if (store.itvChannelsCategory() !== deferred.category) {
            return;
        }

        untracked(() => {
            this.deferredPlay.set(null);
            this.options.play(deferred.item);
        });
    }
}

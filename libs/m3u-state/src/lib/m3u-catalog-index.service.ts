import { Injectable, Signal, computed, inject } from '@angular/core';
import { Store, createSelector } from '@ngrx/store';
import { ParentalLockService, SettingsStore } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    M3uCatalogIndex,
    M3uContentKind,
    M3uWithheldGroups,
    buildM3uCatalogIndex,
    withholdM3uCatalogGroups,
} from '@iptvnator/shared/m3u-utils/catalog';
import { resolveAdjacentChannel } from './adjacent-channel.util';
import {
    selectChannels,
    selectChannelsLoading,
    selectPlaylistState,
} from './selectors';
import {
    M3uCatalogSectionFlags,
    M3uCatalogSectionsSource,
    m3uCatalogSource,
} from './m3u-catalog-source';

/**
 * The playlist the stored channel rows were read from, if known.
 *
 * Defined here, behind the catalog entry point, rather than with the other
 * selectors: only the lazily loaded catalog and M3U player read it, and the
 * selectors module is on the startup path.
 */
export const selectChannelsPlaylistId = createSelector(
    selectPlaylistState,
    (state) => state.channelsPlaylistId ?? null
);

// Built on first use rather than at module load: the barrel is on the
// startup path, and a top-level call keeps the classifier in the initial
// bundle.
let emptyIndex: M3uCatalogIndex<Channel> | undefined;
const emptyIndexOf = (): M3uCatalogIndex<Channel> =>
    (emptyIndex ||= buildM3uCatalogIndex<Channel>([]));

/**
 * Owns the derived catalog index for the loaded M3U playlist.
 *
 * ## Why the memo needs no cache key
 *
 * `selectChannels` returns the same array REFERENCE until a
 * `ChannelActions.setChannels` dispatch replaces it, and `computed()`
 * memoises on `Object.is` of what it reads. So the index is already keyed on
 * exactly the right thing — "these channels", which in practice means "this
 * playlist's current content" — and a hand-rolled `playlistId + count` key
 * would be a second, weaker source of truth that could disagree with the
 * store after a refresh replaced the rows without changing their number.
 *
 * ## Why it is lazy
 *
 * `computed()` does not run until something reads it. A viewer who only ever
 * opens the live channel list never pays for the index at all, and the
 * route session's existing "already loaded" guard means moving between the
 * live, movie and series sections does not re-dispatch `setChannels` and so
 * does not rebuild it.
 */
@Injectable({ providedIn: 'root' })
export class M3uCatalogIndexService implements M3uCatalogSectionsSource {
    private readonly store = inject(Store);
    private readonly settingsStore = inject(SettingsStore);
    private readonly parentalLock = inject(ParentalLockService);

    constructor() {
        // The startup path reads it through `m3uCatalogSource`, so
        // it stays out of the initial bundle.
        m3uCatalogSource.set(this);
    }

    private readonly channels: Signal<Channel[]> =
        this.store.selectSignal(selectChannels);

    /**
     * True while the route session is replacing the channel array.
     *
     * Switching playlists keeps the previous playlist's rows in the store
     * until the new ones arrive, under the new playlist's URL and id.
     */
    readonly loading: Signal<boolean> = this.store.selectSignal(
        selectChannelsLoading
    );

    /**
     * The playlist the indexed rows were read from, or null when unknown.
     *
     * The rail reads this before trusting the counts: outside an M3U route
     * the active playlist can change while the rows stay those of the last
     * playlist opened.
     */
    readonly rowsPlaylistId: Signal<string | null> = this.store.selectSignal(
        selectChannelsPlaylistId
    );

    private readonly knownSections = new Map<string, M3uCatalogSectionFlags>();

    /**
     * Which catalog sections a playlist has rows for, or null when it has
     * not been seen this session.
     *
     * Answered from the rows while they are this playlist's, and from the
     * last such answer otherwise: while it loads (the index is empty then,
     * and the rail links would blink out on every reload), on Favorites and
     * Recent (which do not load the rows), and off an M3U route, where the
     * active playlist can change while the rows stay another's. One
     * playlist's answer is never given for another.
     *
     * The rail reads it to decide its links, and section memory reads it so
     * a remembered Movies or Series is not restored once a refresh has
     * emptied it.
     */
    sectionsOf(playlistId: string): M3uCatalogSectionFlags | null {
        if (!this.loading() && this.rowsPlaylistId() === playlistId) {
            const { movie, episode } = this.storedIndex().counts;
            const sections = { movies: movie > 0, series: episode > 0 };
            this.knownSections.set(playlistId, sections);
            return sections;
        }

        return this.knownSections.get(playlistId) ?? null;
    }

    /** Index of whatever the store holds, current or not. */
    private readonly storedIndex: Signal<M3uCatalogIndex<Channel>> = computed(
        () => buildM3uCatalogIndex(this.channels())
    );

    /**
     * The groups the parental lock withholds from the rows' playlist now.
     *
     * Read the way the channel list reads it: nothing while the lock is
     * inactive or unlocked, everything when the lock store cannot be read.
     * `version` moves on every lock, unlock and relock, so the catalog
     * follows the lock without a reload.
     */
    readonly withheldGroups: Signal<M3uWithheldGroups> = computed(() => {
        const lock = this.parentalLock;
        lock.version();
        if (!lock.active()) {
            return null;
        }
        if (lock.withholdsEverything()) {
            return 'all';
        }
        const playlistId = this.rowsPlaylistId();
        const titles = playlistId ? lock.lockedGroupTitles(playlistId) : [];
        return titles.length > 0 ? new Set(titles) : null;
    });

    /** The stored index without the rows the lock withholds. */
    private readonly visibleIndex: Signal<M3uCatalogIndex<Channel>> = computed(
        () =>
            withholdM3uCatalogGroups(this.storedIndex(), this.withheldGroups())
    );

    /**
     * Every episode row, locked groups included — empty while a load is in
     * flight. The series layer aggregates these and withholds afterwards,
     * so locking a group never moves an episode id.
     */
    readonly allEpisodes: Signal<readonly Channel[]> = computed(() =>
        this.loading() ? [] : this.storedIndex().byKind.episode
    );

    /**
     * Rows split by content kind, with per-kind group buckets — empty while
     * a load is in flight.
     *
     * The catalog, the series layer (`M3uSeriesCatalogService`) and the
     * rail links read this, and
     * none of them may show the previous playlist's rows: a card would open
     * a film from another source, and an episode id would be minted with
     * the new playlist's id, so its progress would be saved against the
     * wrong playlist.
     */
    readonly index: Signal<M3uCatalogIndex<Channel>> = computed(() =>
        this.loading() ? emptyIndexOf() : this.visibleIndex()
    );

    /** True once the playlist holds something other than live channels. */
    readonly hasNonLiveContent: Signal<boolean> = computed(
        () => this.storedIndex().hasNonLiveContent
    );

    /**
     * True when films and episodes have somewhere else to go, so the live
     * views may stop carrying them.
     */
    readonly splitsCatalog: Signal<boolean> = computed(
        () =>
            this.settingsStore.m3uCatalogTabs?.() !== false &&
            this.hasNonLiveContent()
    );

    /**
     * What the live channel list should render.
     *
     * Without this the Movies and Series sections would be additive rather
     * than a split: every film and episode would still sit in the live list
     * too, and the viewer would still scroll past 58,000 of them to reach a
     * channel. Falls back to the complete list whenever the split is off or
     * the playlist is live-only, so the setting genuinely restores today's
     * behaviour and a live-only playlist is untouched.
     */
    readonly liveChannels: Signal<readonly Channel[]> = computed(() =>
        this.splitsCatalog() ? this.storedIndex().liveChannels : this.channels()
    );

    /**
     * The channel a "next" or "previous" step lands on: zapping walks the
     * list the viewer sees, not the stored array with its films and
     * episodes. The root effects call this through `m3uCatalogSource`.
     */
    adjacentChannel(
        direction: 'next' | 'previous',
        active: Channel | undefined,
        allChannels: readonly Channel[]
    ): Channel | undefined {
        return resolveAdjacentChannel(
            direction,
            active,
            allChannels,
            this.liveChannels()
        );
    }

    channelsOfKind(kind: M3uContentKind): Signal<readonly Channel[]> {
        return computed(() => this.index().byKind[kind]);
    }

    groupsOfKind(kind: M3uContentKind) {
        return computed(() => this.index().groupsByKind[kind]);
    }
}

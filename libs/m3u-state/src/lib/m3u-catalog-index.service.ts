import { Injectable, Signal, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { SettingsStore } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    M3uCatalogIndex,
    M3uContentKind,
    M3uSeries,
    buildM3uCatalogIndex,
    buildM3uSeriesCatalog,
} from '@iptvnator/shared/m3u-utils';
import {
    selectActivePlaylistId,
    selectChannels,
    selectChannelsLoading,
} from './selectors';

const EMPTY_INDEX: M3uCatalogIndex<Channel> = buildM3uCatalogIndex<Channel>([]);

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
export class M3uCatalogIndexService {
    private readonly store = inject(Store);
    private readonly settingsStore = inject(SettingsStore);

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

    /** Index of whatever the store holds, current or not. */
    private readonly storedIndex: Signal<M3uCatalogIndex<Channel>> = computed(
        () => buildM3uCatalogIndex(this.channels())
    );

    /**
     * Rows split by content kind, with per-kind group buckets — empty while
     * a load is in flight.
     *
     * The catalog, the series detail and the rail links read this, and
     * none of them may show the previous playlist's rows: a card would open
     * a film from another source, and an episode id would be minted with
     * the new playlist's id, so its progress would be saved against the
     * wrong playlist.
     */
    readonly index: Signal<M3uCatalogIndex<Channel>> = computed(() =>
        this.loading() ? EMPTY_INDEX : this.storedIndex()
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

    private readonly playlistId: Signal<string> = this.store.selectSignal(
        selectActivePlaylistId
    );

    /**
     * The series layer, kept as its own `computed` so it is only built when
     * something reads it. It is the expensive half — title normalization
     * runs per episode row, which is 40k of them on a real catalog — and a
     * viewer who never opens the Series section should not pay for it.
     */
    readonly series: Signal<readonly M3uSeries<Channel>[]> = computed(() =>
        buildM3uSeriesCatalog(this.index().byKind.episode, this.playlistId())
    );

    /** Series by their stable numeric id, for the detail route. */
    readonly seriesById: Signal<ReadonlyMap<number, M3uSeries<Channel>>> =
        computed(
            () => new Map(this.series().map((series) => [series.id, series]))
        );

    channelsOfKind(kind: M3uContentKind): Signal<readonly Channel[]> {
        return computed(() => this.index().byKind[kind]);
    }

    groupsOfKind(kind: M3uContentKind) {
        return computed(() => this.index().groupsByKind[kind]);
    }
}

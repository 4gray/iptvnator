import { Injectable, Signal, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    M3uCatalogIndex,
    M3uContentKind,
    buildM3uCatalogIndex,
} from '@iptvnator/shared/m3u-utils';
import { selectChannels } from './selectors';

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

    private readonly channels: Signal<Channel[]> =
        this.store.selectSignal(selectChannels);

    /** Rows split by content kind, with per-kind group buckets. */
    readonly index: Signal<M3uCatalogIndex<Channel>> = computed(() =>
        buildM3uCatalogIndex(this.channels())
    );

    /** True once the playlist holds something other than live channels. */
    readonly hasNonLiveContent: Signal<boolean> = computed(
        () => this.index().hasNonLiveContent
    );

    channelsOfKind(kind: M3uContentKind): Signal<readonly Channel[]> {
        return computed(() => this.index().byKind[kind]);
    }

    groupsOfKind(kind: M3uContentKind) {
        return computed(() => this.index().groupsByKind[kind]);
    }
}

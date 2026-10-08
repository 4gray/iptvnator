import {
    M3uClassifiableEntry,
    M3uContentKind,
    classifyM3uEntry,
} from './m3u-content-kind.util';

/**
 * A derived view of one playlist: its rows split by content kind, and each
 * kind's rows bucketed by `group-title`.
 *
 * ## Why this is derived rather than stored
 *
 * M3U channels live in a single JSON payload column, and the whole array is
 * already held in memory once a playlist route loads. Measured on a real
 * 62,696-entry playlist the complete index costs well under the 120 ms
 * budget, so there is nothing to gain from a schema migration, a background
 * worker or a cached copy — and a derived index works identically in
 * Electron and in the PWA, which a SQLite-backed one would not.
 *
 * ## Why groups are bucketed per kind
 *
 * Groups mix kinds. In the playlist this was built against, "Netflix
 * Türkiye" holds both films and series episodes, and "Deutsche Disney+"
 * holds films alongside a `S01 E01` catalog. A single group→rows map would
 * force every consumer to re-filter, and the Movies tab would show a group
 * that contains no films.
 */
export interface M3uCatalogEntry extends M3uClassifiableEntry {
    readonly group?: { readonly title?: string | null } | null;
}

export interface M3uCatalogGroup<T> {
    /** The exact original `group-title`, or '' for ungrouped rows. */
    readonly title: string;
    readonly channels: readonly T[];
}

export interface M3uCatalogIndex<T> {
    readonly byKind: Readonly<Record<M3uContentKind, readonly T[]>>;
    /**
     * Live and radio rows together, in the provider's own order.
     *
     * The live channel list renders this rather than `byKind.live`:
     * concatenating the two buckets would put every radio station after
     * every TV channel, which is not how the playlist is written. Built in
     * the same pass so it costs nothing.
     */
    readonly liveChannels: readonly T[];
    readonly groupsByKind: Readonly<
        Record<M3uContentKind, readonly M3uCatalogGroup<T>[]>
    >;
    readonly counts: Readonly<Record<M3uContentKind, number>>;
    /** True when the playlist has rows of some kind other than live. */
    readonly hasNonLiveContent: boolean;
}

const KINDS: readonly M3uContentKind[] = ['live', 'movie', 'episode', 'radio'];

/**
 * Builds the index in one pass.
 *
 * Deliberately absent: a channel→kind lookup map. Keying 62k rows costs
 * several megabytes and buys nothing, because the one consumer that needs
 * the kind of a SINGLE channel — the player, when a row is activated — can
 * call `classifyM3uEntry` directly in microseconds.
 */
export function buildM3uCatalogIndex<T extends M3uCatalogEntry>(
    channels: readonly T[] | null | undefined
): M3uCatalogIndex<T> {
    const byKind = emptyKindRecord<T[]>(() => []);
    const liveChannels: T[] = [];
    const groupOrder = emptyKindRecord<string[]>(() => []);
    const groupRows = emptyKindRecord<Map<string, T[]>>(() => new Map());

    for (const channel of channels ?? []) {
        const kind = classifyM3uEntry(channel);
        byKind[kind].push(channel);
        if (kind === 'live' || kind === 'radio') {
            liveChannels.push(channel);
        }

        const title = channel.group?.title ?? '';
        const buckets = groupRows[kind];
        let rows = buckets.get(title);
        if (!rows) {
            rows = [];
            buckets.set(title, rows);
            // Group order follows first appearance, so the rail keeps the
            // provider's own ordering until a sort mode says otherwise.
            groupOrder[kind].push(title);
        }
        rows.push(channel);
    }

    const groupsByKind = emptyKindRecord<M3uCatalogGroup<T>[]>(() => []);
    const counts = emptyKindRecord<number>(() => 0);
    for (const kind of KINDS) {
        counts[kind] = byKind[kind].length;
        groupsByKind[kind] = groupOrder[kind].map((title) => ({
            title,
            channels: groupRows[kind].get(title) ?? [],
        }));
    }

    return {
        byKind,
        liveChannels,
        groupsByKind,
        counts,
        hasNonLiveContent: counts.movie > 0 || counts.episode > 0,
    };
}

function emptyKindRecord<V>(create: () => V): Record<M3uContentKind, V> {
    return {
        live: create(),
        movie: create(),
        episode: create(),
        radio: create(),
    };
}

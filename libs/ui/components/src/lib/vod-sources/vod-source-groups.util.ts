import {
    playlistDisplayLabel,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';

/**
 * Collapses sources that come from the same playlist.
 *
 * One playlist frequently carries the same film several times under different
 * stream ids — different rips, dubs or quality ladders. Flat, those rows are
 * indistinguishable: same label, same monogram, same tags. Grouping turns "five
 * identical rows" into "one playlist, 5 copies" and moves the difference into
 * the expanded variants, where it can actually be read.
 */

export interface VodSourceGroup {
    /** Stable across renders: the playlist is the group. */
    key: string;
    label: string;
    /** The row shown when collapsed. */
    primary: VodSourceDescriptor;
    /** Every source in the group, primary included, in discovery order. */
    sources: VodSourceDescriptor[];
    /** Collapsed groups still need to advertise how much they hide. */
    count: number;
    hasActive: boolean;
}

export function groupVodSources(
    sources: readonly VodSourceDescriptor[]
): VodSourceGroup[] {
    const byPlaylist = new Map<string, VodSourceDescriptor[]>();

    for (const source of sources) {
        const existing = byPlaylist.get(source.playlistId);
        if (existing) {
            existing.push(source);
        } else {
            byPlaylist.set(source.playlistId, [source]);
        }
    }

    return [...byPlaylist.entries()].map(([key, groupSources]) => ({
        key,
        label: playlistDisplayLabel(
            groupSources[0].playlistName,
            groupSources[0].playlistId
        ),
        // The playing copy must be the face of the group, or the user sees
        // "5 copies" with no indication that one of them is on screen.
        primary: groupSources.find((s) => s.isActive) ?? groupSources[0],
        sources: groupSources,
        count: groupSources.length,
        hasActive: groupSources.some((s) => s.isActive),
    }));
}


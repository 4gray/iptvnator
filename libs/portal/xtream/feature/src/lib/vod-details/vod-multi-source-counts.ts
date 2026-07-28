import { Signal, computed } from '@angular/core';
import type { VodSourceDescriptor } from '@iptvnator/shared/interfaces';

/**
 * What the chip and the caption count.
 *
 * Kept apart because the two numbers differ and the distinction is easy to
 * lose: the chip counts STREAMS, while the caption's "also found in N others"
 * counts PLAYLISTS — the popover groups a playlist's copies under it, so three
 * copies inside one portal must not read as three portals.
 */
export interface VodSourceCounts {
    /** Every source except the one in use. */
    alternatives: Signal<VodSourceDescriptor[]>;
    /** The chip appears only when there is genuinely somewhere else to go. */
    hasAlternatives: Signal<boolean>;
    alternativeCount: Signal<number>;
    alternativePlaylistCount: Signal<number>;
}

export function createVodSourceCounts(
    sources: Signal<VodSourceDescriptor[]>
): VodSourceCounts {
    const alternatives = computed(() =>
        sources().filter((source) => !source.isActive)
    );

    return {
        alternatives,
        hasAlternatives: computed(() => alternatives().length > 0),
        alternativeCount: computed(() => alternatives().length),
        alternativePlaylistCount: computed(
            () => new Set(alternatives().map((s) => s.playlistId)).size
        ),
    };
}

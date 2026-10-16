/**
 * Monotonic counter shared by everything the live tab resolves for the
 * selection on screen — the detail itself, its M3U programmes, a catch-up
 * URL. Anything that started under an older generation landed too late and
 * must be discarded instead of replacing what the user is now watching.
 */
export interface UnifiedLiveSelectionGeneration {
    current(): number;
    /** Invalidate everything in flight and take the next generation. */
    next(): number;
}

export function createUnifiedLiveSelectionGeneration(): UnifiedLiveSelectionGeneration {
    let generation = 0;

    return {
        current: () => generation,
        next: () => ++generation,
    };
}

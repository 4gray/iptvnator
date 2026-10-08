/** The copy whose stored position a reset clears: a pinned copy has its own row. */
export interface VodResetTarget {
    readonly playlistId: string;
    readonly contentId: number;
}

/** Whether two targets name the same copy; nothing matches a missing one. */
export function sameVodResetTarget(
    a: VodResetTarget | null | undefined,
    b: VodResetTarget | null | undefined
): boolean {
    return (
        !!a &&
        !!b &&
        a.playlistId === b.playlistId &&
        a.contentId === b.contentId
    );
}

/** Whether a reset of `target` is among the pending ones. */
export function hasVodResetTarget(
    pending: readonly VodResetTarget[],
    target: VodResetTarget | null | undefined
): boolean {
    return pending.some((entry) => sameVodResetTarget(entry, target));
}

/** The pending resets without one occurrence of `target`: resets of one copy can overlap. */
export function withoutVodResetTarget(
    pending: readonly VodResetTarget[],
    target: VodResetTarget
): readonly VodResetTarget[] {
    const index = pending.findIndex((entry) =>
        sameVodResetTarget(entry, target)
    );
    return index < 0
        ? pending
        : [...pending.slice(0, index), ...pending.slice(index + 1)];
}

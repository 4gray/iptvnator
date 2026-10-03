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

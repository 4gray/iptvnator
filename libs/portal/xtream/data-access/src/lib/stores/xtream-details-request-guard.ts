type PlaylistId = string | null | undefined;

/** Keep synchronous request ownership independent of cold detail resolution. */
export function createXtreamDetailsRequestGuard(
    getCurrentPlaylistId: () => PlaylistId
) {
    let generation = 0;

    return {
        begin(expectedPlaylistId: string): () => boolean {
            const requestGeneration = ++generation;
            return () =>
                requestGeneration === generation &&
                getCurrentPlaylistId() === expectedPlaylistId;
        },
        invalidate(): void {
            generation += 1;
        },
    };
}

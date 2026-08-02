/**
 * A minimal promise concurrency gate for availability checks.
 *
 * "Check all" fires one task per unchecked source, and each task costs a live
 * `get_vod_info` against a foreign portal plus a HEAD request at the stream.
 * Launched unbounded, a movie found in fifteen playlists turns the popover
 * into a fifteen-connection burst — enough for a touchy panel to rate-limit
 * the account it came from. The gate keeps a fixed number in flight and
 * starts the rest as slots free up, in arrival order.
 */
export function createCheckQueue(
    limit: number
): <T>(task: () => Promise<T>) => Promise<T> {
    let active = 0;
    const waiting: (() => void)[] = [];

    const release = (): void => {
        active--;
        waiting.shift()?.();
    };

    return async <T>(task: () => Promise<T>): Promise<T> => {
        if (active >= limit) {
            await new Promise<void>((resolve) => waiting.push(resolve));
        }

        active++;
        try {
            return await task();
        } finally {
            release();
        }
    };
}

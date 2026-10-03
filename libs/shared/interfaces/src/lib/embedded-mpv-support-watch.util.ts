import type { EmbeddedMpvSupport } from './embedded-mpv-session.interface';

/**
 * How soon an inconclusive support answer is asked for again. The main
 * process answers from its cached probe meanwhile, so a recheck costs one
 * IPC round trip and spawns nothing.
 */
export const EMBEDDED_MPV_SUPPORT_RECHECK_MS = 3000;

/**
 * Asks for embedded MPV support and hands every answer to `onAnswer`. An
 * `inconclusive` answer is not final, so it is asked for again until a final
 * one arrives or the returned function is called. A failed request ends the
 * watch through `onError`, as a final answer would.
 *
 * For surfaces that stay mounted on one answer (the player, the settings
 * page). A surface that asks on demand simply asks again the next time.
 */
export function watchEmbeddedMpvSupport(
    getSupport: () => Promise<EmbeddedMpvSupport>,
    onAnswer: (support: EmbeddedMpvSupport) => void,
    onError: (error: unknown) => void
): () => void {
    let stopped = false;
    let recheck: ReturnType<typeof setTimeout> | undefined;

    const ask = async (): Promise<void> => {
        let support: EmbeddedMpvSupport;
        try {
            support = await getSupport();
        } catch (error) {
            if (!stopped) {
                onError(error);
            }
            return;
        }
        if (stopped) {
            return;
        }
        onAnswer(support);
        if (support.inconclusive) {
            recheck = setTimeout(
                () => void ask(),
                EMBEDDED_MPV_SUPPORT_RECHECK_MS
            );
        }
    };
    void ask();

    return () => {
        stopped = true;
        clearTimeout(recheck);
    };
}

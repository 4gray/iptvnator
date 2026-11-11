import { externalPlayerSessions } from './external-player-runtime';

const IDLE_CHECK_INTERVAL_MS = 2_000;

/** The process can stay open after its stream stops. */
export function markExternalPlayerOpened(
    sessionId: string,
    readIdle?: (
        stillPlaying: () => boolean
    ) => Promise<boolean | null | undefined>
) {
    const opened = externalPlayerSessions.markOpened(sessionId);
    if (!readIdle || opened?.status !== 'opened' || opened.contentInfo)
        return opened;

    const stillPlaying = () => {
        const current = externalPlayerSessions.getSession(sessionId);
        return (
            (current?.status === 'opened' || current?.status === 'playing') &&
            !current.playbackIdle
        );
    };
    const schedule = () => setTimeout(check, IDLE_CHECK_INTERVAL_MS).unref();
    const check = async () => {
        if (!stillPlaying()) return;
        try {
            const idle = await readIdle(stillPlaying);
            if (idle === undefined || !stillPlaying()) return;
            if (
                idle !== null &&
                externalPlayerSessions.getSession(sessionId)?.playbackIdle !==
                    idle
            )
                externalPlayerSessions.updateSession(sessionId, {
                    playbackIdle: idle,
                });
            if (idle) return;
        } catch {
            // A missing IPC reply does not prove that playback ended.
        }
        if (stillPlaying()) schedule();
    };
    schedule();
    return opened;
}

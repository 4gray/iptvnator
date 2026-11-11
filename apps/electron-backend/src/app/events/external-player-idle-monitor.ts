import { externalPlayerSessions } from './external-player-runtime';

const IDLE_CHECK_INTERVAL_MS = 2_000;

/** The process can stay open after its stream stops. */
export function markExternalPlayerOpened(
    sessionId: string,
    readIdle?: (isCurrent: () => boolean) => Promise<boolean | null | undefined>
) {
    const opened = externalPlayerSessions.markOpened(sessionId);
    if (!readIdle || opened?.status !== 'opened' || opened.contentInfo)
        return opened;

    const isCurrent = () => {
        const current = externalPlayerSessions.getSession(sessionId);
        return current?.status === 'opened' || current?.status === 'playing';
    };
    const schedule = () => setTimeout(check, IDLE_CHECK_INTERVAL_MS).unref();
    const check = async () => {
        if (!isCurrent()) return;
        try {
            const idle = await readIdle(isCurrent);
            if (idle === undefined || !isCurrent()) return;
            if (
                idle !== null &&
                externalPlayerSessions.getSession(sessionId)?.playbackIdle !==
                    idle
            )
                externalPlayerSessions.updateSession(sessionId, {
                    playbackIdle: idle,
                });
        } catch {
            // A missing IPC reply does not prove that playback ended.
        }
        if (isCurrent()) schedule();
    };
    schedule();
    return opened;
}

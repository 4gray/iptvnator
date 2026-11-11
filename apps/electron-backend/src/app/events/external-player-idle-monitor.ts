import { externalPlayerSessions } from './external-player-runtime';

const IDLE_CHECK_INTERVAL_MS = 2_000;

/** The process can stay open after its stream stops. */
export function markExternalPlayerOpened(
    sessionId: string,
    readIdle?: (
        isCurrent: () => boolean
    ) => Promise<boolean | null | undefined>,
    reportUnreadable = false
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
        const idle = await readIdle(isCurrent).catch(() => null);
        if (idle === undefined || !isCurrent()) return;
        const current = externalPlayerSessions.getSession(sessionId);
        const unreadable = reportUnreadable && idle === null ? true : undefined;
        if (
            (idle !== null && current?.playbackIdle !== idle) ||
            (reportUnreadable && current?.playbackUnverified !== unreadable)
        )
            externalPlayerSessions.updateSession(sessionId, {
                playbackIdle: idle ?? current?.playbackIdle,
                ...(reportUnreadable ? { playbackUnverified: unreadable } : {}),
            });
        if (isCurrent()) schedule();
    };
    schedule();
    return opened;
}

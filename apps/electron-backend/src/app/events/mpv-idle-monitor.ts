import { externalPlayerSessions } from './external-player-runtime';
import { sendMpvCommand } from './mpv-ipc-command';

const IDLE_CHECK_INTERVAL_MS = 2_000;

/** MPV can keep the process and its closer alive after a live stream ends. */
export function markMpvOpened(sessionId: string, socketPath?: string | null) {
    const opened = externalPlayerSessions.markOpened(sessionId);
    if (!socketPath || opened?.status !== 'opened' || opened.contentInfo)
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
            const reply = await sendMpvCommand(
                socketPath,
                'get_property',
                ['idle-active'],
                {
                    shouldDispatch: stillPlaying,
                }
            );
            if (reply && reply.data === true && stillPlaying()) {
                externalPlayerSessions.updateSession(sessionId, {
                    playbackIdle: true,
                });
                return;
            }
        } catch {
            // A missing IPC reply does not prove that playback ended.
        }
        if (stillPlaying()) schedule();
    };
    schedule();
    return opened;
}

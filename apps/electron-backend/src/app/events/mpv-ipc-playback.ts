import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { externalPlayerSessions } from './external-player-runtime';
import {
    allowExternalPlayerMediaDispatch,
    markExternalPlayerOpened,
} from './external-player-idle-monitor';
import {
    MPV_IPC_COMMAND_TIMEOUT_MS,
    MpvIpcCommandError,
    type MpvMediaOutcome,
    sendMpvCommand,
} from './mpv-ipc-command';

export function prepareFreshMpvMedia(playerPath: string) {
    if (/(?:^|[\\/])iina(?:-cli)?$/i.test(playerPath)) return undefined;
    const controller = new AbortController();
    let awaitingDispatch = true;
    return {
        signal: controller.signal,
        abort: () => controller.abort(),
        get awaitingDispatch() {
            return awaitingDispatch;
        },
        settleDispatch: () => {
            awaitingDispatch = false;
        },
    };
}

export function publishMpvMediaOutcome(
    sessionId: string,
    loaded: MpvMediaOutcome
): void {
    const current = externalPlayerSessions.getSession(sessionId);
    if (!current || current.status === 'closed' || current.status === 'error')
        return;
    externalPlayerSessions.updateSession(
        sessionId,
        loaded === undefined || loaded === 'unsupported'
            ? {
                  mediaLoaded: false,
                  playbackUnverified: true,
                  ...(loaded === 'unsupported' && {
                      mediaObservationUnavailable: true,
                  }),
              }
            : loaded
              ? {
                    mediaLoaded: true,
                    playbackIdle: false,
                    playbackUnverified: undefined,
                }
              : { mediaLoaded: false, playbackIdle: true }
    );
}

export function markMpvOpened(
    sessionId: string,
    socketPath?: string | null,
    hasOwner = () => true,
    confirmFreshMedia = false
) {
    const current = externalPlayerSessions.getSession(sessionId);
    if (
        confirmFreshMedia &&
        current?.status === 'launching' &&
        current.mediaLoaded !== true
    )
        externalPlayerSessions.updateSession(sessionId, {
            mediaLoaded: false,
            playbackUnverified: socketPath ? current.playbackUnverified : true,
            mediaObservationUnavailable: socketPath
                ? current.mediaObservationUnavailable
                : true,
        });
    return markExternalPlayerOpened(
        sessionId,
        socketPath
            ? async (shouldDispatch) => {
                  if (!hasOwner()) return undefined;
                  const canRead = () => shouldDispatch() && hasOwner();
                  const reply = await sendMpvCommand(
                      socketPath,
                      'get_property',
                      ['idle-active'],
                      { shouldDispatch: canRead }
                  );
                  if (!canRead()) return undefined;
                  return reply && typeof reply.data === 'boolean'
                      ? reply.data
                      : null;
              }
            : undefined
    );
}

export async function completeFreshMpvLaunch(
    session: ExternalPlayerSession,
    socketPath: string | null,
    hasOwner: () => boolean,
    guideLaunch: boolean,
    media?: ReturnType<typeof prepareFreshMpvMedia>
): Promise<ExternalPlayerSession | null> {
    const signal = media?.signal;
    if (socketPath && signal && !signal.aborted) {
        const current = externalPlayerSessions.getSession(session.id);
        if (current?.status === 'launching')
            externalPlayerSessions.updateSession(session.id, {
                mediaLoaded: false,
            });
        if (
            !(await loadFreshMpvGuideMedia(
                session.id,
                socketPath,
                session.streamUrl,
                hasOwner,
                signal,
                media?.settleDispatch
            ))
        )
            return null;
    }
    if (signal?.aborted)
        return externalPlayerSessions.getSession(session.id) ?? session;
    markMpvOpened(
        session.id,
        guideLaunch && !signal ? null : socketPath,
        hasOwner,
        guideLaunch
    );
    return externalPlayerSessions.getSession(session.id) ?? session;
}

/** Dispatch once the new child exposes IPC, then observe the exact loadfile entry. */
export async function loadFreshMpvGuideMedia(
    sessionId: string,
    socketPath: string,
    url: string,
    hasOwner: () => boolean,
    signal: AbortSignal,
    onDispatched?: () => void
): Promise<boolean> {
    const deadline = Date.now() + MPV_IPC_COMMAND_TIMEOUT_MS;
    const shouldDispatch = () => {
        const status = externalPlayerSessions.getSession(sessionId)?.status;
        return (
            !signal.aborted &&
            hasOwner() &&
            (status === 'launching' ||
                status === 'opened' ||
                status === 'playing')
        );
    };
    while (shouldDispatch()) {
        try {
            await sendMpvCommand(socketPath, 'loadfile', [url, 'replace'], {
                shouldDispatch: () =>
                    shouldDispatch() &&
                    allowExternalPlayerMediaDispatch(sessionId),
                onDispatched,
                media: {
                    signal,
                    onOutcome: (loaded) => {
                        if (shouldDispatch())
                            publishMpvMediaOutcome(sessionId, loaded);
                    },
                },
            });
            return true;
        } catch (error) {
            if (
                error instanceof MpvIpcCommandError &&
                !error.dispatched &&
                shouldDispatch()
            ) {
                if (Date.now() >= deadline) return false;
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, 50).unref()
                );
                continue;
            }
            if (shouldDispatch()) publishMpvMediaOutcome(sessionId, undefined);
            return true;
        }
    }
    return true;
}

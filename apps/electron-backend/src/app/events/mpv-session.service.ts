import { spawn } from 'child_process';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
    readExternalPlayerErrorCode,
} from '@iptvnator/shared/interfaces';
import {
    MPV_PLAYER_ARGUMENTS,
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import {
    buildExternalPlayerSpawnSpec,
    buildPlayerArgsWithCustomArguments,
    getDefaultMpvPath,
    isRunningInFlatpak,
    normalizeCustomPlayerPath,
    parseExternalPlayerArguments,
    PlayerPathOptions,
    resolveExternalPlayerLaunchContext,
    shouldReuseMpvInstance,
    shouldUseMpvSocketBridge,
} from './external-player-launch-context';
import { joinMpvHeaderFields } from '../util/mpv-string-list.util';
import { resolveEffectiveExternalPlaybackRequest } from './external-player-playback-request';
import {
    buildPlayerStartError,
    externalPlayerSessions,
    maskUrlForLogs,
    sendPlayerErrorNotification,
    traceExternalPlayer,
} from './external-player-runtime';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import {
    assertQueuedLaunchAllowed,
    MpvLaunchQueue,
    QueuedMpvLaunch,
    settleCancelledQueuedLaunch,
} from './mpv-launch-queue';
import {
    MpvReusableProcess,
    MpvReuseAttemptState,
} from './mpv-reusable-process';
import { attachMpvOutputHandlers } from './mpv-output-errors';
import {
    startPositionPolling,
    stopPositionPolling,
} from './mpv-position-polling';

export interface OpenExternalPlayerRequest {
    url: string;
    title: string;
    thumbnail?: string;
    userAgent?: string;
    referer?: string;
    origin?: string;
    contentInfo?: PlayerContentInfo;
    startTime?: number;
    headers?: Record<string, string>;
}

const reusableMpvProcess = new MpvReusableProcess();
function getMpvPath(options: PlayerPathOptions = {}): string {
    return (
        normalizeCustomPlayerPath(store.get(MPV_PLAYER_PATH)) ??
        getDefaultMpvPath(options)
    );
}

export function setMpvReuseInstance(reuseInstance: boolean): void {
    traceExternalPlayer('set mpv reuse instance', { reuseInstance });
    store.set(MPV_REUSE_INSTANCE, reuseInstance);

    if (!reuseInstance) {
        reusableMpvProcess.stopStored(
            'clean up mpv process after disabling reuse',
            stopPositionPolling,
            true
        );
    }
}

/**
 * Kill the MPV instance kept alive for reuse. The reused process is spawned
 * non-detached with piped stdio, so without an explicit kill it outlives the
 * app and keeps playing after quit.
 */
export function shutdownMpvSession(): void {
    mpvLaunchQueue.cancelAll();
    reusableMpvProcess.stopStored(
        'kill reused mpv process on app shutdown',
        stopPositionPolling
    );
}

// MPV launches run one at a time; see MpvLaunchQueue. Each launch begins its
// session at once, so the newest launch is the active one Stop targets.
const mpvLaunchQueue = new MpvLaunchQueue(() =>
    reusableMpvProcess.storedOwnerSessionId()
);

export function openMpvPlayer(
    request: OpenExternalPlayerRequest
): Promise<ExternalPlayerSession> {
    try {
        externalPlayerProcessTeardownGate.assertLaunchAllowed();
    } catch (error) {
        return Promise.reject(error);
    }
    const displacedSessionId = externalPlayerSessions.getActiveSessionId();
    const session = externalPlayerSessions.beginSession({
        player: 'mpv',
        title: request.title,
        thumbnail: request.thumbnail,
        streamUrl: request.url,
        contentInfo: request.contentInfo,
    });
    return mpvLaunchQueue.enqueue(session, (queue) =>
        launchMpvPlayer(request, session, displacedSessionId, queue)
    );
}

async function launchMpvPlayer(
    {
        url,
        title,
        userAgent,
        referer,
        origin,
        contentInfo,
        startTime,
        headers,
    }: OpenExternalPlayerRequest,
    session: ExternalPlayerSession,
    displacedSessionId: string | null,
    queue: QueuedMpvLaunch
): Promise<ExternalPlayerSession> {
    const current = externalPlayerSessions.getSession(session.id);
    // Stopped while it waited in the queue, directly or by a later Stop.
    if (current?.status === 'closed') return current;
    if (queue.queued && queue.cancelled()) {
        return settleCancelledQueuedLaunch(session, queue.pendingStop());
    }
    if (queue.queued) {
        // The last started launch owns the child the gate waits for; the
        // session displaced at enqueue time is the fallback.
        assertQueuedLaunchAllowed(session, [
            queue.lastStartedSessionId(),
            displacedSessionId,
        ]);
    }
    queue.markInFlight();
    const previousProcessSessionId = reusableMpvProcess.currentSessionId();
    const reuseState: MpvReuseAttemptState = {
        teardownUnconfirmed: false,
        contentMutated: false,
    };
    let freshTeardownUnconfirmed = false;

    try {
        const isFlatpak = isRunningInFlatpak();
        const mpvLaunchContext = resolveExternalPlayerLaunchContext(
            'mpv',
            getMpvPath({ isFlatpak }),
            { isFlatpak }
        );
        const customMpvArguments = store.get(MPV_PLAYER_ARGUMENTS, '');
        const requestedReuseInstance = store.get(MPV_REUSE_INSTANCE, false);
        const reuseInstance = shouldReuseMpvInstance(
            requestedReuseInstance,
            isFlatpak
        );
        const useMpvSocketBridge = shouldUseMpvSocketBridge(isFlatpak);
        const {
            effectiveOrigin,
            effectiveReferer,
            effectiveUserAgent,
            headerFields,
        } = resolveEffectiveExternalPlaybackRequest({
            url,
            userAgent,
            referer,
            origin,
            headers,
        });

        traceExternalPlayer('open mpv player', {
            path: mpvLaunchContext.playerPath,
            launchMode: mpvLaunchContext.mode,
            requestedReuseInstance,
            reuseInstance,
            stream: maskUrlForLogs(url),
            hasUserAgent: Boolean(effectiveUserAgent),
            hasReferer: Boolean(effectiveReferer),
            hasOrigin: Boolean(effectiveOrigin),
            headerCount: headerFields.length,
            hasContentInfo: Boolean(contentInfo),
            startTime: startTime ?? null,
            customArgumentCount:
                parseExternalPlayerArguments(customMpvArguments).length,
        });

        if (reuseInstance) {
            const reused = await reusableMpvProcess.tryReuse({
                session,
                previousProcessSessionId,
                url,
                title,
                effectiveUserAgent,
                effectiveReferer,
                headerFields,
                contentInfo,
                startTime,
                state: reuseState,
                startPositionPolling,
                stopPositionPolling,
            });
            if (reused) return reused;
        }

        traceExternalPlayer('create new mpv instance');

        let socketPath: string | null = null;
        const args: string[] = [];

        if (useMpvSocketBridge) {
            socketPath =
                process.platform === 'win32'
                    ? `\\\\.\\pipe\\mpv-${Date.now()}`
                    : `/tmp/mpvsocket-${Date.now()}`;
            args.push(`--input-ipc-server=${socketPath}`, '--idle=yes');
        }

        args.push('--ytdl=no');

        if (effectiveUserAgent) {
            args.push(`--user-agent=${effectiveUserAgent}`);
        }

        if (effectiveReferer) {
            args.push(`--referrer=${effectiveReferer}`);
        }

        if (headerFields.length > 0) {
            args.push(
                `--http-header-fields=${joinMpvHeaderFields(headerFields)}`
            );
        }

        if (title) {
            args.push(`--force-media-title=${title}`);
        }

        if (startTime) {
            args.push(`--start=${startTime}`);
        }

        args.push(url);

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            let startConfirmationTimer: NodeJS.Timeout | null = null;
            const resolveLaunch = () => {
                if (settled) {
                    return;
                }
                settled = true;
                if (startConfirmationTimer) {
                    clearTimeout(startConfirmationTimer);
                }
                resolve();
            };
            const rejectLaunch = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (startConfirmationTimer) {
                    clearTimeout(startConfirmationTimer);
                }
                reject(error);
            };
            const spawnSpec = buildExternalPlayerSpawnSpec(
                mpvLaunchContext,
                buildPlayerArgsWithCustomArguments(customMpvArguments, args)
            );
            // Reuse teardown yields while waiting for the old child. Another
            // external process may enter teardown during that window, so the
            // process-wide invariant must be checked at the actual spawn too.
            externalPlayerProcessTeardownGate.assertLaunchAllowed();
            const proc = spawn(spawnSpec.command, spawnSpec.args, {
                shell: false,
                detached: !reuseInstance,
                stdio: reuseInstance ? ['ignore', 'pipe', 'pipe'] : 'ignore',
            });

            attachMpvOutputHandlers(proc);

            proc.on('error', (err) => {
                console.error('Failed to start MPV player:', err);
                const processSessionId = reusableMpvProcess.sessionIdFor(
                    proc,
                    session.id
                );
                reusableMpvProcess.clear(proc);
                stopPositionPolling();
                externalPlayerSessions.markError(
                    processSessionId,
                    `Failed to start MPV player: ${err.message}`,
                    { code: 'start-failed' }
                );
                rejectLaunch(
                    buildPlayerStartError('MPV', err, mpvLaunchContext)
                );
            });

            proc.on('exit', (code) => {
                traceExternalPlayer('mpv exited', { code });
                const processSessionId = reusableMpvProcess.sessionIdFor(
                    proc,
                    session.id
                );
                reusableMpvProcess.clear(proc);
                stopPositionPolling();

                if (code !== 0 && code !== null) {
                    console.error(
                        `[MPV ERROR] MPV exited with error code ${code}`
                    );
                    sendPlayerErrorNotification(
                        'MPV',
                        `MPV player closed unexpectedly (exit code: ${code})`,
                        'closed-unexpectedly'
                    );
                    externalPlayerSessions.markError(
                        processSessionId,
                        `MPV player closed unexpectedly (exit code: ${code})`,
                        { code: 'closed-unexpectedly' }
                    );
                    resolveLaunch();
                    return;
                }

                externalPlayerSessions.markClosed(processSessionId);
                resolveLaunch();
            });

            if (reuseInstance && socketPath) {
                reusableMpvProcess.track(proc, socketPath, session.id);
                traceExternalPlayer('stored mpv process for reuse', {
                    socketPath,
                });
            } else {
                proc.unref();
            }

            externalPlayerSessions.attachCloser(session.id, async () => {
                if (
                    reuseInstance &&
                    !reusableMpvProcess.owns(proc, session.id)
                ) {
                    return;
                }
                try {
                    await externalPlayerProcessTeardownGate.terminate(proc);
                } catch (error) {
                    const teardownError =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    freshTeardownUnconfirmed = true;
                    externalPlayerSessions.markError(
                        session.id,
                        teardownError.message,
                        { canClose: true }
                    );
                    rejectLaunch(teardownError);
                    throw teardownError;
                }
            });

            if (useMpvSocketBridge && contentInfo && socketPath) {
                startPositionPolling(socketPath, contentInfo, session.id);
            }

            startConfirmationTimer = setTimeout(() => {
                if (!proc.killed) {
                    resolveLaunch();
                }
            }, 100);
            startConfirmationTimer.unref();
        });

        return externalPlayerSessions.markOpened(session.id) ?? session;
    } catch (error) {
        console.error('Error opening MPV player:', error);
        if (!reuseState.teardownUnconfirmed && !freshTeardownUnconfirmed) {
            stopPositionPolling();
        }
        const restoredSession =
            reuseState.teardownUnconfirmed &&
            !reuseState.contentMutated &&
            displacedSessionId
                ? externalPlayerSessions.restoreActiveSession(
                      displacedSessionId,
                      session.id
                  )
                : null;
        externalPlayerSessions.markError(
            session.id,
            error instanceof Error ? error.message : String(error),
            {
                code: readExternalPlayerErrorCode(error) ?? undefined,
                canClose:
                    freshTeardownUnconfirmed ||
                    (reuseState.teardownUnconfirmed &&
                        (reuseState.contentMutated || !restoredSession)),
            }
        );
        throw error;
    }
}

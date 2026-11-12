import type { ChildProcess } from 'child_process';
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
    buildFreshMpvArgs,
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
import {
    completeFreshMpvLaunch,
    prepareFreshMpvMedia,
} from './mpv-ipc-playback';
import {
    createMpvIpcEndpoint,
    spawnPlayerWithEndpoint,
} from './mpv-ipc-endpoint';
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
    launchId?: string;
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
        launchId: request.launchId,
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
    request: OpenExternalPlayerRequest,
    session: ExternalPlayerSession,
    displacedSessionId: string | null,
    queue: QueuedMpvLaunch,
    forcePositional = false
): Promise<ExternalPlayerSession> {
    const {
        url,
        title,
        userAgent,
        referer,
        origin,
        contentInfo,
        startTime,
        headers,
    } = request;
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

        if (reuseInstance && !forcePositional) {
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

        const endpoint = useMpvSocketBridge
            ? createMpvIpcEndpoint()
            : undefined;
        const socketPath = endpoint?.path ?? null;
        const tracksProcess = reuseInstance && !!socketPath;
        const args = buildFreshMpvArgs(socketPath, {
            userAgent: effectiveUserAgent,
            referer: effectiveReferer,
            headerArgument: joinMpvHeaderFields(headerFields),
            title,
            startTime,
        });

        const guideLaunch = !!session.launchId && !contentInfo;
        const media =
            guideLaunch && socketPath && !forcePositional
                ? prepareFreshMpvMedia(mpvLaunchContext.playerPath)
                : undefined;
        if (!media) args.push(url);

        let fallingBack = false;
        let stopRequested = false;
        const proc = await new Promise<ChildProcess>((resolve, reject) => {
            let settled = false;
            const resolveLaunch = () => {
                if (settled) return;
                settled = true;
                clearTimeout(startConfirmationTimer);
                resolve(proc);
            };
            const rejectLaunch = (error: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(startConfirmationTimer);
                reject(error);
            };
            const spawnSpec = buildExternalPlayerSpawnSpec(
                mpvLaunchContext,
                buildPlayerArgsWithCustomArguments(customMpvArguments, args)
            );
            // Reuse teardown yields while waiting for the old child. Another
            // external process may enter teardown during that window, so the
            // process-wide invariant must be checked at the actual spawn too.
            const proc = spawnPlayerWithEndpoint(
                spawnSpec.command,
                spawnSpec.args,
                tracksProcess,
                endpoint
            );

            attachMpvOutputHandlers(proc);

            proc.on('error', (err) => {
                media?.abort();
                console.error('Failed to start MPV player:', err);
                const processSessionId = reusableMpvProcess.sessionIdFor(
                    proc,
                    session.id
                );
                reusableMpvProcess.clear(proc);
                stopPositionPolling(processSessionId);
                if (fallingBack) return resolveLaunch();
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
                media?.abort();
                const processSessionId = reusableMpvProcess.sessionIdFor(
                    proc,
                    session.id
                );
                reusableMpvProcess.clear(proc);
                stopPositionPolling(processSessionId);
                fallingBack ||= !!media?.awaitingDispatch && !stopRequested;
                if (fallingBack) return resolveLaunch();

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

            if (tracksProcess && socketPath) {
                reusableMpvProcess.track(proc, socketPath, session.id);
            } else proc.unref();

            externalPlayerSessions.attachCloser(session.id, async () => {
                stopRequested = true;
                media?.abort();
                if (
                    tracksProcess &&
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

            const startConfirmationTimer = setTimeout(() => {
                if (!proc.killed) resolveLaunch();
            }, 100);
            startConfirmationTimer.unref();
        });

        const opened = await completeFreshMpvLaunch(
            session,
            socketPath,
            () =>
                !tracksProcess ||
                reusableMpvProcess.currentSessionId() === session.id,
            guideLaunch,
            media
        );
        media?.settleDispatch();
        if (opened && !fallingBack) return opened;
        fallingBack = true;
        try {
            await externalPlayerProcessTeardownGate.terminate(proc);
        } catch (error) {
            fallingBack = false;
            freshTeardownUnconfirmed = true;
            throw error;
        }
        if (stopRequested)
            return externalPlayerSessions.markClosed(session.id) ?? session;
        return launchMpvPlayer(
            request,
            session,
            displacedSessionId,
            queue,
            true
        );
    } catch (error) {
        console.error('Error opening MPV player:', error);
        if (!reuseState.teardownUnconfirmed && !freshTeardownUnconfirmed) {
            stopPositionPolling(session.id);
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

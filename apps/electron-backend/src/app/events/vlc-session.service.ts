import { spawn } from 'child_process';
import { AddressInfo, createServer } from 'net';
import { PlayerContentInfo } from '@iptvnator/shared/interfaces';
import {
    VLC_PLAYER_ARGUMENTS,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import {
    buildExternalPlayerSpawnSpec,
    buildPlayerArgsWithCustomArguments,
    getDefaultVlcPath,
    isRunningInFlatpak,
    normalizeCustomPlayerPath,
    parseExternalPlayerArguments,
    PlayerPathOptions,
    resolveExternalPlayerLaunchContext,
    shouldReuseVlcInstance,
} from './external-player-launch-context';
import { resolveEffectiveExternalPlaybackRequest } from './external-player-playback-request';
import {
    buildPlayerStartError,
    ExternalPlaybackSnapshot,
    externalPlayerSessions,
    maskUrlForLogs,
    sendPlaybackPositionUpdate,
    sendPlayerErrorNotification,
    traceExternalPlayer,
} from './external-player-runtime';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import { getVlcPlaybackSnapshot, getVlcPlaybackState } from './vlc-rc';
export {
    buildVlcEnqueueCommands,
    parseVlcRcNumericResponse,
    parseVlcRcPlaybackState,
} from './vlc-rc';
import {
    VlcReusableProcess,
    VlcReuseAttemptState,
} from './vlc-reusable-process';

export interface OpenVlcPlayerRequest {
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

const reusableVlcProcess = new VlcReusableProcess();
let vlcPollingInterval: NodeJS.Timeout | null = null;

function getVlcPath(options: PlayerPathOptions = {}): string {
    return (
        normalizeCustomPlayerPath(store.get(VLC_PLAYER_PATH)) ??
        getDefaultVlcPath(options)
    );
}

function stopVlcPositionPolling(): void {
    if (vlcPollingInterval) {
        clearInterval(vlcPollingInterval);
        vlcPollingInterval = null;
    }
}

function startVlcPositionPolling(
    port: number,
    contentInfo: PlayerContentInfo,
    sessionId: string,
    onSnapshot?: (snapshot: ExternalPlaybackSnapshot) => void,
    onStopped?: () => void
): void {
    stopVlcPositionPolling();

    setTimeout(() => {
        vlcPollingInterval = setInterval(async () => {
            try {
                const snapshot = await getVlcPlaybackSnapshot(port);

                if (snapshot) {
                    onSnapshot?.(snapshot);
                    sendPlaybackPositionUpdate(
                        sessionId,
                        contentInfo,
                        snapshot
                    );
                    return;
                }

                const playbackState = await getVlcPlaybackState(port);
                if (playbackState === 'stopped') {
                    onStopped?.();
                    stopVlcPositionPolling();
                }
            } catch {
                stopVlcPositionPolling();
            }
        }, 2000);
    }, 1500);
}

function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as AddressInfo;
            const port = address.port;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

export function setVlcReuseInstance(reuseInstance: boolean): void {
    traceExternalPlayer('set vlc reuse instance', { reuseInstance });
    store.set(VLC_REUSE_INSTANCE, reuseInstance);

    if (!reuseInstance) {
        reusableVlcProcess.stopStored(
            'clean up vlc process after disabling reuse',
            stopVlcPositionPolling,
            true
        );
    }
}

/**
 * Kill the VLC instance kept alive for reuse. The reused process is spawned
 * non-detached, so without an explicit kill it outlives the app and keeps
 * playing after quit.
 */
export function shutdownVlcSession(): void {
    reusableVlcProcess.stopStored(
        'kill reused vlc process on app shutdown',
        stopVlcPositionPolling
    );
}

export async function openVlcPlayer({
    url,
    title,
    thumbnail,
    userAgent,
    referer,
    origin,
    contentInfo,
    startTime,
    headers,
}: OpenVlcPlayerRequest) {
    externalPlayerProcessTeardownGate.assertLaunchAllowed();
    const displacedSessionId = externalPlayerSessions.getActiveSessionId();
    const previousProcessSessionId = reusableVlcProcess.currentSessionId();
    const session = externalPlayerSessions.beginSession({
        player: 'vlc',
        title,
        thumbnail,
        streamUrl: url,
        contentInfo,
    });
    const reuseState: VlcReuseAttemptState = {
        teardownUnconfirmed: false,
        contentMutated: false,
        closeRequested: false,
        requestedClose: null,
    };
    let freshTeardownUnconfirmed = false;

    try {
        const isFlatpak = isRunningInFlatpak();
        const vlcLaunchContext = resolveExternalPlayerLaunchContext(
            'vlc',
            getVlcPath({ isFlatpak }),
            { isFlatpak }
        );
        const customVlcArguments = store.get(VLC_PLAYER_ARGUMENTS, '');
        const requestedReuseInstance = store.get(VLC_REUSE_INSTANCE, false);
        const reuseInstance = shouldReuseVlcInstance(
            requestedReuseInstance,
            isFlatpak
        );
        const {
            mergedHeaders,
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
        traceExternalPlayer('open vlc player', {
            path: vlcLaunchContext.playerPath,
            launchMode: vlcLaunchContext.mode,
            requestedReuseInstance,
            reuseInstance,
            stream: maskUrlForLogs(url),
            hasUserAgent: Boolean(effectiveUserAgent),
            hasReferer: Boolean(effectiveReferer),
            hasOrigin: Boolean(effectiveOrigin),
            hasContentInfo: Boolean(contentInfo),
            startTime: startTime ?? null,
            customArgumentCount:
                parseExternalPlayerArguments(customVlcArguments).length,
        });

        if (reuseInstance) {
            const reused = await reusableVlcProcess.tryReuse({
                session,
                previousProcessSessionId,
                url,
                title,
                effectiveUserAgent,
                effectiveReferer,
                effectiveOrigin,
                mergedHeaders,
                contentInfo,
                startTime,
                state: reuseState,
                startPositionPolling: startVlcPositionPolling,
                stopPositionPolling: stopVlcPositionPolling,
            });
            if (reused) return reused;
        }

        let rcPort = 0;
        if (contentInfo || reuseInstance) {
            try {
                rcPort = await getFreePort();
                traceExternalPlayer('using vlc rc port', { rcPort });
            } catch (e) {
                console.error('Failed to get free port for VLC:', e);
            }
        }

        const args: string[] = [];

        if (rcPort > 0) {
            args.push('--extraintf=rc');
            args.push(`--rc-host=127.0.0.1:${rcPort}`);
            if (process.platform === 'win32') {
                // Keep TCP control without VLC's separate DOS console.
                args.push('--rc-quiet');
            }
        }

        if (effectiveUserAgent) {
            args.push(`:http-user-agent=${effectiveUserAgent}`);
        }

        if (effectiveReferer) {
            args.push(`:http-referrer=${effectiveReferer}`);
        }

        if (effectiveOrigin && !effectiveReferer) {
            args.push(`:http-referrer=${effectiveOrigin}`);
        }

        // Same field list MPV sends via --http-header-fields: a real
        // `Origin: ...` header (deduplicated against the merged headers)
        // plus every non-empty custom header.
        headerFields.forEach((field) => {
            args.push(`:http-header=${field}`);
        });

        if (startTime) {
            args.push(`--start-time=${startTime}`);
        }

        args.push(url);
        if (title) {
            args.push(`:meta-title=${title}`);
        }

        traceExternalPlayer('vlc args prepared', {
            argCount: args.length,
            hasRcPort: rcPort > 0,
        });
        let lastVlcSnapshot: ExternalPlaybackSnapshot | null = null;

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            let closeRequested = false;
            let requestedClose: Promise<void> | null = null;

            const resolveSpawn = () => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve();
            };

            const rejectSpawn = (error: Error) => {
                if (settled) {
                    return;
                }

                settled = true;
                reject(error);
            };

            const spawnVlc = (playerArgs: string[], isRetry = false) => {
                if (reuseState.closeRequested) {
                    closeRequested = true;
                    const pendingReuseClose =
                        reuseState.requestedClose ?? Promise.resolve();
                    void pendingReuseClose.then(() => {
                        externalPlayerSessions.markClosed(session.id);
                        resolveSpawn();
                    }, rejectSpawn);
                    return;
                }
                if (
                    externalPlayerSessions.getSession(session.id)?.status ===
                    'closed'
                ) {
                    closeRequested = true;
                    resolveSpawn();
                    return;
                }
                try {
                    // Port allocation and reuse fallback both yield. Another
                    // exact child can enter teardown during either wait, so
                    // the process-wide invariant must be checked at the
                    // actual spawn boundary as well as at request entry.
                    externalPlayerProcessTeardownGate.assertLaunchAllowed();
                } catch (error) {
                    const launchError =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    if (settled) {
                        const current = externalPlayerSessions.getSession(
                            session.id
                        );
                        if (current?.status !== 'closed') {
                            externalPlayerSessions.markError(
                                session.id,
                                launchError.message
                            );
                        }
                    } else {
                        rejectSpawn(launchError);
                    }
                    return;
                }
                const spawnSpec = buildExternalPlayerSpawnSpec(
                    vlcLaunchContext,
                    buildPlayerArgsWithCustomArguments(
                        customVlcArguments,
                        playerArgs
                    )
                );
                // Reuse ownership exists only when an RC port was allocated.
                // Without it this child is a normal one-shot process whose
                // exact session closer must still terminate it.
                const trackProcess = reuseInstance && !isRetry && rcPort > 0;
                const proc = spawn(spawnSpec.command, spawnSpec.args, {
                    shell: false,
                    detached: !trackProcess,
                    stdio: trackProcess ? ['ignore', 'pipe', 'pipe'] : 'ignore',
                });

                proc.once('spawn', () => {
                    if (!closeRequested) {
                        resolveSpawn();
                    }
                });

                if (trackProcess && rcPort > 0) {
                    reusableVlcProcess.track(proc, rcPort, session.id);
                    traceExternalPlayer('tracking vlc process for reuse', {
                        rcPort,
                    });
                }

                const markVlcSessionClosed = () => {
                    if (
                        externalPlayerSessions.getSession(session.id)
                            ?.status === 'closed'
                    ) {
                        return;
                    }

                    if (lastVlcSnapshot && contentInfo) {
                        sendPlaybackPositionUpdate(
                            session.id,
                            contentInfo,
                            lastVlcSnapshot
                        );
                    }

                    externalPlayerSessions.markClosed(session.id);
                };

                const flushVlcPlaybackPosition = async () => {
                    if (isRetry || rcPort <= 0 || !contentInfo) {
                        return;
                    }

                    const snapshot =
                        (await getVlcPlaybackSnapshot(rcPort)) ??
                        lastVlcSnapshot;
                    if (!snapshot) {
                        return;
                    }

                    lastVlcSnapshot = snapshot;
                    sendPlaybackPositionUpdate(
                        session.id,
                        contentInfo,
                        snapshot
                    );
                };

                externalPlayerSessions.attachCloser(session.id, () => {
                    closeRequested = true;
                    if (
                        trackProcess &&
                        !reusableVlcProcess.owns(proc, session.id)
                    ) {
                        return;
                    }
                    if (!requestedClose) {
                        // Position flush uses two bounded RC requests. Guard
                        // the exact child before either request yields so no
                        // replacement can reuse or overlap it while Stop is
                        // still preparing the teardown.
                        externalPlayerProcessTeardownGate.beginTeardown(proc);
                        const closeAttempt = (async () => {
                            await flushVlcPlaybackPosition();
                            await externalPlayerProcessTeardownGate.terminate(
                                proc
                            );
                        })();
                        requestedClose = closeAttempt;
                        void closeAttempt.catch((error) => {
                            if (requestedClose === closeAttempt) {
                                requestedClose = null;
                            }
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
                            rejectSpawn(teardownError);
                        });
                    }
                    return requestedClose;
                });

                if (!isRetry && rcPort > 0 && contentInfo) {
                    startVlcPositionPolling(
                        rcPort,
                        contentInfo,
                        session.id,
                        (snapshot) => {
                            lastVlcSnapshot = snapshot;
                        },
                        () => {
                            markVlcSessionClosed();
                        }
                    );
                }

                if (proc.stdout) {
                    proc.stdout.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            traceExternalPlayer('vlc stdout', { output });
                        }
                    });
                }

                if (proc.stderr) {
                    proc.stderr.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            console.error('[VLC stderr]:', output);
                        }
                    });
                }

                proc.on('error', (err) => {
                    console.error('Failed to start VLC player:', err);
                    const processSessionId = reusableVlcProcess.sessionIdFor(
                        proc,
                        session.id
                    );
                    reusableVlcProcess.clear(proc);
                    if (closeRequested) {
                        void requestedClose?.then(() => {
                            // A spawn failure reports `close` without an
                            // `exit` event. Close the exact session before
                            // settling OPEN_VLC_PLAYER so the renderer
                            // cannot receive a stale `opened` result.
                            externalPlayerSessions.markClosed(session.id);
                            resolveSpawn();
                        }, rejectSpawn);
                        return;
                    }
                    if (!isRetry && rcPort > 0) {
                        traceExternalPlayer(
                            'retry vlc without rc interface after start error'
                        );
                        const retryArgs = playerArgs.filter(
                            (arg) =>
                                !arg.includes('--extraintf') &&
                                !arg.includes('--rc-host') &&
                                arg !== '--rc-quiet'
                        );
                        spawnVlc(retryArgs, true);
                    } else {
                        externalPlayerSessions.markError(
                            processSessionId,
                            `Failed to start VLC player: ${err.message}`
                        );
                        rejectSpawn(
                            buildPlayerStartError('VLC', err, vlcLaunchContext)
                        );
                    }
                });

                proc.on('exit', (code) => {
                    traceExternalPlayer('vlc exited', { code });
                    const processSessionId = reusableVlcProcess.sessionIdFor(
                        proc,
                        session.id
                    );
                    reusableVlcProcess.clear(proc);
                    stopVlcPositionPolling();

                    if (
                        !closeRequested &&
                        lastVlcSnapshot &&
                        contentInfo &&
                        externalPlayerSessions.getSession(session.id)
                            ?.status !== 'closed'
                    ) {
                        sendPlaybackPositionUpdate(
                            session.id,
                            contentInfo,
                            lastVlcSnapshot
                        );
                    }

                    if (
                        code === 1 &&
                        !closeRequested &&
                        !isRetry &&
                        rcPort > 0
                    ) {
                        traceExternalPlayer(
                            'retry vlc without rc interface after exit'
                        );
                        stopVlcPositionPolling();
                        const retryArgs = playerArgs.filter(
                            (arg) =>
                                !arg.includes('--extraintf') &&
                                !arg.includes('--rc-host') &&
                                arg !== '--rc-quiet'
                        );
                        spawnVlc(retryArgs, true);
                        return;
                    }

                    if (code !== 0 && code !== null) {
                        console.error(
                            `[VLC ERROR] VLC exited with error code ${code}`
                        );
                        sendPlayerErrorNotification(
                            'VLC',
                            `VLC player closed unexpectedly (exit code: ${code})`
                        );
                        externalPlayerSessions.markError(
                            processSessionId,
                            `VLC player closed unexpectedly (exit code: ${code})`
                        );
                        resolveSpawn();
                        return;
                    }

                    externalPlayerSessions.markClosed(processSessionId);
                    resolveSpawn();
                });

                if (!trackProcess) {
                    proc.unref();
                }
            };

            spawnVlc(args);
        });

        return externalPlayerSessions.markOpened(session.id) ?? session;
    } catch (error) {
        console.error('Error opening VLC player:', error);
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
                canClose:
                    freshTeardownUnconfirmed ||
                    (reuseState.teardownUnconfirmed &&
                        (reuseState.contentMutated || !restoredSession)),
            }
        );
        throw error;
    }
}

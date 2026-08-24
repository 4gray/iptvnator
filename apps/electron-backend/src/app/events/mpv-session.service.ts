import { spawn } from 'child_process';
import { createConnection } from 'net';
import { PlayerContentInfo } from '@iptvnator/shared/interfaces';
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
    sendPlaybackPositionUpdate,
    sendPlayerErrorNotification,
    traceExternalPlayer,
} from './external-player-runtime';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import {
    MpvReusableProcess,
    MpvReuseAttemptState,
} from './mpv-reusable-process';

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
let positionPollingInterval: NodeJS.Timeout | null = null;

function getMpvPath(options: PlayerPathOptions = {}): string {
    return (
        normalizeCustomPlayerPath(store.get(MPV_PLAYER_PATH)) ??
        getDefaultMpvPath(options)
    );
}

async function getMpvProperty(
    socketPath: string,
    property: string
): Promise<number | null> {
    return new Promise((resolve) => {
        const client = createConnection(socketPath);
        const request =
            JSON.stringify({
                command: ['get_property', property],
            }) + '\n';

        let data = '';

        client.on('connect', () => {
            client.write(request);
        });

        const timeoutHandle = setTimeout(() => {
            client.destroy();
            resolve(null);
        }, 2000);

        client.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('\n')) {
                clearTimeout(timeoutHandle);
                try {
                    const lines = data.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const response = JSON.parse(line);
                        if (response.data !== undefined) {
                            client.destroy();
                            resolve(response.data);
                            return;
                        }
                    }
                } catch {
                    // Ignore partial JSON while MPV is still writing.
                }
            }
        });

        client.on('end', () => {
            clearTimeout(timeoutHandle);
            if (data && !data.includes('\n')) {
                try {
                    const response = JSON.parse(data);
                    resolve(response.data ?? null);
                } catch {
                    resolve(null);
                }
            }
        });

        client.on('error', () => {
            clearTimeout(timeoutHandle);
            resolve(null);
        });
    });
}

function stopPositionPolling(): void {
    if (positionPollingInterval) {
        clearInterval(positionPollingInterval);
        positionPollingInterval = null;
    }
}

function shouldIgnoreMpvStdoutLine(line: string): boolean {
    return /^(\(Paused\)\s*)?AV:\s/.test(line);
}

function startPositionPolling(
    socketPath: string,
    contentInfo: PlayerContentInfo,
    sessionId: string
): void {
    stopPositionPolling();

    setTimeout(() => {
        positionPollingInterval = setInterval(async () => {
            try {
                const position = await getMpvProperty(socketPath, 'time-pos');
                const duration = await getMpvProperty(socketPath, 'duration');

                if (position !== null) {
                    sendPlaybackPositionUpdate(sessionId, contentInfo, {
                        positionSeconds: Math.floor(position),
                        durationSeconds: duration ? Math.floor(duration) : null,
                    });
                }
            } catch {
                stopPositionPolling();
            }
        }, 5000);
    }, 2000);
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
    reusableMpvProcess.stopStored(
        'kill reused mpv process on app shutdown',
        stopPositionPolling
    );
}

export async function openMpvPlayer({
    url,
    title,
    thumbnail,
    userAgent,
    referer,
    origin,
    contentInfo,
    startTime,
    headers,
}: OpenExternalPlayerRequest) {
    externalPlayerProcessTeardownGate.assertLaunchAllowed();
    const displacedSessionId = externalPlayerSessions.getActiveSessionId();
    const previousProcessSessionId = reusableMpvProcess.currentSessionId();
    const session = externalPlayerSessions.beginSession({
        player: 'mpv',
        title,
        thumbnail,
        streamUrl: url,
        contentInfo,
    });
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

        // HD buffering: lavf options are init-only; HLS ignores demuxer-readahead-secs so cache-secs is the operative lever.
        args.push(
            '--demuxer-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1'
        );
        args.push(
            '--demuxer-lavf-o=protocol_whitelist=file,crypto,http,https,tcp,tls,crypto'
        );
        args.push('--cache-secs=30');

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

            if (proc.stdout) {
                proc.stdout.on('data', (data) => {
                    const lines = data
                        .toString()
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean);

                    for (const output of lines) {
                        if (shouldIgnoreMpvStdoutLine(output)) {
                            continue;
                        }

                        traceExternalPlayer('mpv stdout', { output });

                        if (
                            output.includes('Failed to open') ||
                            output.includes('Error opening') ||
                            output.includes('Protocol not found') ||
                            output.includes('Connection refused') ||
                            output.includes('error') ||
                            output.includes('403') ||
                            output.includes('404')
                        ) {
                            console.error('[MPV ERROR from stdout]:', output);
                            sendPlayerErrorNotification('MPV', output);
                        }
                    }
                });
            }

            if (proc.stderr) {
                proc.stderr.on('data', (data) => {
                    const output = data.toString().trim();
                    if (output) {
                        console.error('[MPV stderr]:', output);

                        if (
                            output.includes('Failed to open') ||
                            output.includes(
                                'Exiting... (Errors when loading file)'
                            ) ||
                            output.includes('Error opening') ||
                            output.includes('Protocol not found') ||
                            output.includes('Connection refused') ||
                            output.includes('error') ||
                            output.includes('403') ||
                            output.includes('404')
                        ) {
                            console.error('[MPV ERROR]:', output);
                            sendPlayerErrorNotification('MPV', output);
                        }
                    }
                });
            }

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
                    `Failed to start MPV player: ${err.message}`
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
                        `MPV player closed unexpectedly (exit code: ${code})`
                    );
                    externalPlayerSessions.markError(
                        processSessionId,
                        `MPV player closed unexpectedly (exit code: ${code})`
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
                canClose:
                    freshTeardownUnconfirmed ||
                    (reuseState.teardownUnconfirmed &&
                        (reuseState.contentMutated || !restoredSession)),
            }
        );
        throw error;
    }
}

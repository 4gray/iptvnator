import { ChildProcess, spawn } from 'child_process';
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
import { resolveEffectiveExternalPlaybackRequest } from './external-player-playback-request';
import {
    buildPlayerStartError,
    externalPlayerSessions,
    maskUrlForLogs,
    sendPlaybackPositionUpdate,
    sendPlayerErrorNotification,
    traceExternalPlayer,
} from './external-player-runtime';

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

let mpvProcess: ChildProcess | null = null;
let mpvSocketPath: string | null = null;
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

function sendMpvCommand(
    command: string,
    args: Array<string | number>
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!mpvSocketPath) {
            reject(new Error('No MPV socket path available'));
            return;
        }

        const client = createConnection(mpvSocketPath);
        const request = JSON.stringify({ command: [command, ...args] }) + '\n';

        client.on('connect', () => {
            traceExternalPlayer('mpv ipc command', {
                command,
                argsCount: args.length,
            });
            client.write(request);
            client.end();
            resolve();
        });

        client.on('error', (err) => {
            console.error('MPV socket error:', err);
            reject(err);
        });
    });
}

function killStoredMpvProcess(reason: string): void {
    if (!mpvProcess || mpvProcess.killed) {
        return;
    }
    traceExternalPlayer(reason);
    mpvProcess.kill();
    mpvProcess = null;
    mpvSocketPath = null;
    stopPositionPolling();
}

export function setMpvReuseInstance(reuseInstance: boolean): void {
    traceExternalPlayer('set mpv reuse instance', { reuseInstance });
    store.set(MPV_REUSE_INSTANCE, reuseInstance);

    if (!reuseInstance) {
        killStoredMpvProcess('clean up mpv process after disabling reuse');
    }
}

/**
 * Kill the MPV instance kept alive for reuse. The reused process is spawned
 * non-detached with piped stdio, so without an explicit kill it outlives the
 * app and keeps playing after quit.
 */
export function shutdownMpvSession(): void {
    killStoredMpvProcess('kill reused mpv process on app shutdown');
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
    const session = externalPlayerSessions.beginSession({
        player: 'mpv',
        title,
        thumbnail,
        streamUrl: url,
        contentInfo,
    });

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

        if (
            reuseInstance &&
            mpvProcess &&
            !mpvProcess.killed &&
            mpvSocketPath
        ) {
            traceExternalPlayer('reuse existing mpv instance');
            try {
                if (effectiveUserAgent) {
                    await sendMpvCommand('set_property', [
                        'user-agent',
                        effectiveUserAgent,
                    ]);
                }
                if (effectiveReferer) {
                    await sendMpvCommand('set_property', [
                        'referrer',
                        effectiveReferer,
                    ]);
                }
                if (headerFields.length > 0) {
                    await sendMpvCommand('set_property', [
                        'http-header-fields',
                        headerFields.join(','),
                    ]);
                }

                const loadFileArgs: Array<string | number> = [url, 'replace'];
                const loadFileOptions: string[] = [];

                if (title) {
                    loadFileOptions.push(`force-media-title=${title}`);
                }
                if (loadFileOptions.length > 0) {
                    loadFileArgs.push(-1, loadFileOptions.join(','));
                }

                await sendMpvCommand('loadfile', loadFileArgs);
                traceExternalPlayer('loaded new url in existing mpv instance');

                externalPlayerSessions.attachCloser(session.id, async () => {
                    try {
                        await sendMpvCommand('quit', []);
                    } catch {
                        if (mpvProcess && !mpvProcess.killed) {
                            mpvProcess.kill();
                        }
                    }
                });

                if (startTime) {
                    await sendMpvCommand('seek', [
                        String(startTime),
                        'absolute',
                    ]);
                }

                if (contentInfo) {
                    startPositionPolling(
                        mpvSocketPath,
                        contentInfo,
                        session.id
                    );
                } else {
                    stopPositionPolling();
                }

                return externalPlayerSessions.markOpened(session.id) ?? session;
            } catch (err) {
                console.error('Failed to send command to existing MPV:', err);
                mpvProcess = null;
                mpvSocketPath = null;
                stopPositionPolling();
            }
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
            args.push(`--http-header-fields=${headerFields.join(',')}`);
        }

        if (title) {
            args.push(`--force-media-title=${title}`);
        }

        if (startTime) {
            args.push(`--start=${startTime}`);
        }

        args.push(url);

        await new Promise<void>((resolve, reject) => {
            const spawnSpec = buildExternalPlayerSpawnSpec(
                mpvLaunchContext,
                buildPlayerArgsWithCustomArguments(customMpvArguments, args)
            );
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
                mpvProcess = null;
                mpvSocketPath = null;
                stopPositionPolling();
                externalPlayerSessions.markError(
                    session.id,
                    `Failed to start MPV player: ${err.message}`
                );
                reject(buildPlayerStartError('MPV', err, mpvLaunchContext));
            });

            proc.on('exit', (code) => {
                traceExternalPlayer('mpv exited', { code });
                mpvProcess = null;
                mpvSocketPath = null;
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
                        session.id,
                        `MPV player closed unexpectedly (exit code: ${code})`
                    );
                    return;
                }

                externalPlayerSessions.markClosed(session.id);
            });

            if (reuseInstance && socketPath) {
                mpvProcess = proc;
                mpvSocketPath = socketPath;
                traceExternalPlayer('stored mpv process for reuse', {
                    socketPath,
                });
            } else {
                proc.unref();
            }

            externalPlayerSessions.attachCloser(session.id, async () => {
                if (!proc.killed) {
                    proc.kill();
                }
            });

            if (useMpvSocketBridge && contentInfo && socketPath) {
                startPositionPolling(socketPath, contentInfo, session.id);
            }

            setTimeout(() => {
                if (!proc.killed) {
                    resolve();
                }
            }, 100);
        });

        return externalPlayerSessions.markOpened(session.id) ?? session;
    } catch (error) {
        console.error('Error opening MPV player:', error);
        mpvProcess = null;
        mpvSocketPath = null;
        stopPositionPolling();
        externalPlayerSessions.markError(
            session.id,
            error instanceof Error ? error.message : String(error)
        );
        throw error;
    }
}

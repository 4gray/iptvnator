import { ChildProcess, spawn } from 'child_process';
import { AddressInfo, createConnection, createServer } from 'net';
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

let vlcProcess: ChildProcess | null = null;
let vlcRcPort: number | null = null;
let vlcPollingInterval: NodeJS.Timeout | null = null;

function getVlcPath(options: PlayerPathOptions = {}): string {
    return (
        normalizeCustomPlayerPath(store.get(VLC_PLAYER_PATH)) ??
        getDefaultVlcPath(options)
    );
}

export function buildVlcEnqueueCommands(options: {
    url: string;
    title?: string;
    userAgent?: string;
    referer?: string;
    origin?: string;
    headers?: Record<string, string>;
    startTime?: number;
}): string[] {
    const inputOptions: string[] = [];

    if (options.userAgent) {
        inputOptions.push(`:http-user-agent=${options.userAgent}`);
    }
    if (options.referer) {
        inputOptions.push(`:http-referrer=${options.referer}`);
    } else if (options.origin) {
        inputOptions.push(`:http-referrer=${options.origin}`);
    }
    Object.entries(options.headers ?? {}).forEach(([name, value]) => {
        if (!name || value === undefined || value === null) return;
        const trimmedValue = String(value).trim();
        if (!trimmedValue) return;
        inputOptions.push(`:http-header=${name}: ${trimmedValue}`);
    });
    if (options.title) {
        inputOptions.push(`:meta-title=${options.title}`);
    }

    const inputLine =
        inputOptions.length > 0
            ? `${options.url} ${inputOptions.join(' ')}`
            : options.url;

    const commands = ['clear', `add ${inputLine}`];

    if (options.startTime && Number.isFinite(options.startTime)) {
        commands.push(`seek ${Math.floor(options.startTime)}`);
    }

    return commands;
}

function sendVlcRcCommand(port: number, command: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const client = createConnection({ port, host: '127.0.0.1' });
        let settled = false;

        const finish = (err?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            if (!client.destroyed) client.destroy();
            if (err) {
                reject(err);
                return;
            }

            resolve();
        };

        const timeoutHandle = setTimeout(
            () => finish(new Error('VLC RC command timed out')),
            2000
        );

        client.on('connect', () => {
            client.write(`${command}\n`);
        });
        client.on('data', (chunk) => {
            if (chunk.toString().includes('>')) {
                finish();
            }
        });
        client.on('error', (err) => finish(err));
    });
}

async function sendVlcRcCommands(
    port: number,
    commands: string[]
): Promise<void> {
    for (const command of commands) {
        await sendVlcRcCommand(port, command);
    }
}

export function parseVlcRcNumericResponse(data: string): string {
    const match = data.match(/>\s*(-?\d+(?:\.\d+)?)/);
    return match ? match[1] : '';
}

export function parseVlcRcPlaybackState(data: string): string | null {
    const match = data.match(/\(\s*state\s+([^)]+)\s*\)/i);
    return match ? match[1].trim().toLowerCase() : null;
}

function stopVlcPositionPolling(): void {
    if (vlcPollingInterval) {
        clearInterval(vlcPollingInterval);
        vlcPollingInterval = null;
    }
}

async function getVlcCommandResponse(
    port: number,
    command: string
): Promise<string> {
    return new Promise((resolve) => {
        const client = createConnection({ port, host: '127.0.0.1' });
        let data = '';
        let resolved = false;

        const done = (result: string) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeoutHandle);
            if (!client.destroyed) client.destroy();
            resolve(result);
        };

        const timeoutHandle = setTimeout(() => done(''), 2000);

        client.on('connect', () => {
            client.write(command + '\n');
        });

        client.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('>')) {
                done(data);
            }
        });

        client.on('error', () => done(''));
    });
}

async function getVlcProperty(port: number, command: string): Promise<string> {
    return parseVlcRcNumericResponse(
        await getVlcCommandResponse(port, command)
    );
}

async function getVlcPlaybackState(port: number): Promise<string | null> {
    return parseVlcRcPlaybackState(await getVlcCommandResponse(port, 'status'));
}

async function getVlcPlaybackSnapshot(
    port: number
): Promise<ExternalPlaybackSnapshot | null> {
    const timeStr = await getVlcProperty(port, 'get_time');
    const lenStr = await getVlcProperty(port, 'get_length');

    const position = parseInt(timeStr, 10);
    const duration = parseInt(lenStr, 10);

    if (isNaN(position)) {
        return null;
    }

    return {
        positionSeconds: position,
        durationSeconds: !isNaN(duration) ? duration : null,
    };
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

function killStoredVlcProcess(reason: string): void {
    if (!vlcProcess || vlcProcess.killed) {
        return;
    }
    traceExternalPlayer(reason);
    vlcProcess.kill();
    vlcProcess = null;
    vlcRcPort = null;
    stopVlcPositionPolling();
}

export function setVlcReuseInstance(reuseInstance: boolean): void {
    traceExternalPlayer('set vlc reuse instance', { reuseInstance });
    store.set(VLC_REUSE_INSTANCE, reuseInstance);

    if (!reuseInstance) {
        killStoredVlcProcess('clean up vlc process after disabling reuse');
    }
}

/**
 * Kill the VLC instance kept alive for reuse. The reused process is spawned
 * non-detached, so without an explicit kill it outlives the app and keeps
 * playing after quit.
 */
export function shutdownVlcSession(): void {
    killStoredVlcProcess('kill reused vlc process on app shutdown');
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
    const session = externalPlayerSessions.beginSession({
        player: 'vlc',
        title,
        thumbnail,
        streamUrl: url,
        contentInfo,
    });

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

        if (reuseInstance && vlcProcess && !vlcProcess.killed && vlcRcPort) {
            traceExternalPlayer('reuse existing vlc instance', {
                rcPort: vlcRcPort,
            });
            try {
                const enqueueCommands = buildVlcEnqueueCommands({
                    url,
                    title,
                    userAgent: effectiveUserAgent,
                    referer: effectiveReferer,
                    origin: effectiveOrigin,
                    headers: mergedHeaders,
                    startTime,
                });
                await sendVlcRcCommands(vlcRcPort, enqueueCommands);
                traceExternalPlayer('loaded new url in existing vlc instance');

                const reusedRcPort = vlcRcPort;
                let lastReusedSnapshot: ExternalPlaybackSnapshot | null = null;
                externalPlayerSessions.attachCloser(session.id, async () => {
                    try {
                        await sendVlcRcCommand(reusedRcPort, 'stop');
                    } catch {
                        if (vlcProcess && !vlcProcess.killed) {
                            vlcProcess.kill();
                        }
                    }
                });

                if (contentInfo) {
                    startVlcPositionPolling(
                        reusedRcPort,
                        contentInfo,
                        session.id,
                        (snapshot) => {
                            lastReusedSnapshot = snapshot;
                        },
                        () => {
                            if (
                                lastReusedSnapshot &&
                                externalPlayerSessions.getSession(session.id)
                                    ?.status !== 'closed'
                            ) {
                                sendPlaybackPositionUpdate(
                                    session.id,
                                    contentInfo,
                                    lastReusedSnapshot
                                );
                            }
                            externalPlayerSessions.markClosed(session.id);
                        }
                    );
                } else {
                    stopVlcPositionPolling();
                }

                return externalPlayerSessions.markOpened(session.id) ?? session;
            } catch (err) {
                console.error(
                    'Failed to reuse existing VLC, spawning fresh:',
                    err
                );
                if (vlcProcess && !vlcProcess.killed) {
                    try {
                        vlcProcess.kill();
                    } catch {
                        // Ignore cleanup failures.
                    }
                }
                vlcProcess = null;
                vlcRcPort = null;
                stopVlcPositionPolling();
            }
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

        if (Object.keys(mergedHeaders).length > 0) {
            Object.entries(mergedHeaders).forEach(([name, value]) => {
                if (!name || value === undefined || value === null) return;
                const trimmedValue = String(value).trim();
                if (!trimmedValue) return;
                args.push(`:http-header=${name}: ${trimmedValue}`);
            });
        }

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
                const spawnSpec = buildExternalPlayerSpawnSpec(
                    vlcLaunchContext,
                    buildPlayerArgsWithCustomArguments(
                        customVlcArguments,
                        playerArgs
                    )
                );
                const trackProcess = reuseInstance && !isRetry;
                const proc = spawn(spawnSpec.command, spawnSpec.args, {
                    shell: false,
                    detached: !trackProcess,
                    stdio: trackProcess ? ['ignore', 'pipe', 'pipe'] : 'ignore',
                });

                proc.once('spawn', resolveSpawn);

                if (trackProcess && rcPort > 0) {
                    vlcProcess = proc;
                    vlcRcPort = rcPort;
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

                externalPlayerSessions.attachCloser(session.id, async () => {
                    await flushVlcPlaybackPosition();
                    if (!proc.killed) {
                        proc.kill();
                    }
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
                    if (vlcProcess === proc) {
                        vlcProcess = null;
                        vlcRcPort = null;
                    }
                    if (!isRetry && rcPort > 0) {
                        traceExternalPlayer(
                            'retry vlc without rc interface after start error'
                        );
                        const retryArgs = playerArgs.filter(
                            (arg) =>
                                !arg.includes('--extraintf') &&
                                !arg.includes('--rc-host') &&
                                !arg.includes('--rc-quiet')
                        );
                        spawnVlc(retryArgs, true);
                    } else {
                        externalPlayerSessions.markError(
                            session.id,
                            `Failed to start VLC player: ${err.message}`
                        );
                        rejectSpawn(
                            buildPlayerStartError('VLC', err, vlcLaunchContext)
                        );
                    }
                });

                proc.on('exit', (code) => {
                    traceExternalPlayer('vlc exited', { code });
                    if (vlcProcess === proc) {
                        vlcProcess = null;
                        vlcRcPort = null;
                    }
                    stopVlcPositionPolling();

                    if (
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

                    if (code === 1 && !isRetry && rcPort > 0) {
                        traceExternalPlayer(
                            'retry vlc without rc interface after exit'
                        );
                        stopVlcPositionPolling();
                        const retryArgs = playerArgs.filter(
                            (arg) =>
                                !arg.includes('--extraintf') &&
                                !arg.includes('--rc-host') &&
                                !arg.includes('--rc-quiet')
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
                            session.id,
                            `VLC player closed unexpectedly (exit code: ${code})`
                        );
                        return;
                    }

                    externalPlayerSessions.markClosed(session.id);
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
        externalPlayerSessions.markError(
            session.id,
            error instanceof Error ? error.message : String(error)
        );
        throw error;
    }
}

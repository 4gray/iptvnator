import { ipcMain } from 'electron';
import {
    CLOSE_EXTERNAL_PLAYER_SESSION,
    EXTERNAL_PLAYER_SESSION_UPDATE,
    ExternalPlayerName,
    ExternalPlayerSession,
    parseExternalPlayerArguments,
    type ExternalPlayerArgumentsInput,
} from '@iptvnator/shared/interfaces';
import App from '../app';
import {
    MPV_PLAYER_ARGUMENTS,
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    store,
    VLC_PLAYER_ARGUMENTS,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';

import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { AddressInfo, createConnection, createServer } from 'net';
import path from 'path';
import { getStalkerPlaybackContextHeaders } from '../services/stalker-playback-context.service';
import { ExternalPlayerSessionRegistry } from './external-player-session-registry';

export default class PlayerEvents {
    static bootstrapPlayerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

// Keep track of the running MPV process for reuse
let mpvProcess: ChildProcess | null = null;
let mpvSocketPath: string | null = null;
let positionPollingInterval: NodeJS.Timeout | null = null;

// Keep track of the running VLC process for reuse
let vlcProcess: ChildProcess | null = null;
let vlcRcPort: number | null = null;

interface ExternalPlaybackSnapshot {
    positionSeconds: number;
    durationSeconds: number | null;
}

function sendExternalPlayerSessionUpdate(session: ExternalPlayerSession) {
    if (App.mainWindow && !App.mainWindow.isDestroyed()) {
        App.mainWindow.webContents.send(
            EXTERNAL_PLAYER_SESSION_UPDATE,
            session
        );
    }
}

const externalPlayerSessions = new ExternalPlayerSessionRegistry(
    sendExternalPlayerSessionUpdate
);

type PathExists = (path: string) => boolean;

type ExternalPlayerLaunchMode = 'direct' | 'flatpak-host';

interface PlayerPathOptions {
    platform?: NodeJS.Platform;
    isFlatpak?: boolean;
    pathExists?: PathExists;
}

interface ExternalPlayerLaunchContext {
    mode: ExternalPlayerLaunchMode;
    playerPath: string;
    command: string;
    argsPrefix: string[];
}

interface ExternalPlayerSpawnSpec {
    mode: ExternalPlayerLaunchMode;
    playerPath: string;
    command: string;
    args: string[];
}

export function isRunningInFlatpak(
    pathExists: PathExists = existsSync,
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform === 'linux' && pathExists('/.flatpak-info');
}

function normalizeCustomPlayerPath(
    value: string | null | undefined
): string | null {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : null;
}

function normalizePlayerPathForStore(value: string | null | undefined): string {
    return normalizeCustomPlayerPath(value) ?? '';
}

const macOSAppBundleExecutableNames: Record<ExternalPlayerName, string> = {
    mpv: 'mpv',
    vlc: 'VLC',
};

function getMacOSAppBundleExecutableName(player: ExternalPlayerName): string {
    return macOSAppBundleExecutableNames[player];
}

function removeTrailingPathSeparators(value: string): string {
    return value.replace(/[\\/]+$/, '') || value;
}

function resolveMacOSAppBundlePlayerPath(
    player: ExternalPlayerName,
    playerPath: string,
    platform: NodeJS.Platform
): string {
    if (platform !== 'darwin') {
        return playerPath;
    }

    const appBundlePath = removeTrailingPathSeparators(playerPath);

    if (!/\.app$/i.test(appBundlePath)) {
        return playerPath;
    }

    return path.join(
        appBundlePath,
        'Contents',
        'MacOS',
        getMacOSAppBundleExecutableName(player)
    );
}

function getDefaultPlayerPath(
    player: ExternalPlayerName,
    options: PlayerPathOptions = {}
): string {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
    } = options;

    if (platform === 'linux' && isFlatpak) {
        return player;
    }

    if (player === 'mpv') {
        return getDefaultMpvPath({ platform, isFlatpak, pathExists });
    }

    return getDefaultVlcPath({ platform, isFlatpak, pathExists });
}

export function resolveExternalPlayerLaunchContext(
    player: ExternalPlayerName,
    customPlayerPath?: string,
    options: PlayerPathOptions = {}
): ExternalPlayerLaunchContext {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
    } = options;
    const playerPath =
        normalizeCustomPlayerPath(customPlayerPath) ??
        getDefaultPlayerPath(player, {
            platform,
            isFlatpak,
            pathExists,
        });
    const resolvedPlayerPath = resolveMacOSAppBundlePlayerPath(
        player,
        playerPath,
        platform
    );

    if (platform === 'linux' && isFlatpak) {
        return {
            mode: 'flatpak-host',
            playerPath: resolvedPlayerPath,
            command: 'flatpak-spawn',
            argsPrefix: ['--host', '--watch-bus', resolvedPlayerPath],
        };
    }

    return {
        mode: 'direct',
        playerPath: resolvedPlayerPath,
        command: resolvedPlayerPath,
        argsPrefix: [],
    };
}

export function buildExternalPlayerSpawnSpec(
    launchContext: ExternalPlayerLaunchContext,
    playerArgs: string[]
): ExternalPlayerSpawnSpec {
    return {
        mode: launchContext.mode,
        playerPath: launchContext.playerPath,
        command: launchContext.command,
        args: [...launchContext.argsPrefix, ...playerArgs],
    };
}

export { parseExternalPlayerArguments };

export function buildPlayerArgsWithCustomArguments(
    customArguments: ExternalPlayerArgumentsInput,
    playerArgs: string[]
): string[] {
    return [...parseExternalPlayerArguments(customArguments), ...playerArgs];
}

export function shouldReuseMpvInstance(
    requestedReuseInstance: boolean,
    isFlatpak: boolean = isRunningInFlatpak()
): boolean {
    return !isFlatpak && requestedReuseInstance;
}

export function shouldUseMpvSocketBridge(
    isFlatpak: boolean = isRunningInFlatpak()
): boolean {
    return !isFlatpak;
}

export function shouldReuseVlcInstance(
    requestedReuseInstance: boolean,
    isFlatpak: boolean = isRunningInFlatpak()
): boolean {
    return !isFlatpak && requestedReuseInstance;
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
            err ? reject(err) : resolve();
        };

        const timeoutHandle = setTimeout(
            () => finish(new Error('VLC RC command timed out')),
            2000
        );

        client.on('connect', () => {
            client.write(`${command}\n`);
        });
        // The VLC RC interface emits its '> ' prompt after each command finishes.
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

function buildPlayerStartError(
    player: 'MPV' | 'VLC',
    error: Error,
    launchContext: ExternalPlayerLaunchContext
): Error {
    const guidance =
        launchContext.mode === 'flatpak-host'
            ? `Make sure ${player} is installed on the host system and reachable via Flatpak host spawning at '${launchContext.playerPath}'.`
            : `Make sure ${player} is installed and the path '${launchContext.playerPath}' is correct.`;

    return new Error(
        `Failed to start ${player} player: ${error.message}. ${guidance}`
    );
}

// Helper function to send error notifications to the renderer
function sendPlayerErrorNotification(player: 'MPV' | 'VLC', error: string) {
    if (App.mainWindow && !App.mainWindow.isDestroyed()) {
        // Make error message more user-friendly
        let userMessage = error;

        if (error.includes('Failed to open')) {
            userMessage =
                'Failed to open stream. The URL may be invalid or the server is not responding.';
        } else if (
            error.includes('Protocol not found') ||
            error.includes('Unsupported protocol')
        ) {
            userMessage =
                'Unsupported stream protocol. Please check the stream URL.';
        } else if (
            error.includes('Connection refused') ||
            error.includes('Could not connect')
        ) {
            userMessage =
                'Cannot connect to the stream server. Please check your internet connection.';
        } else if (error.includes('403') || error.includes('Forbidden')) {
            userMessage =
                'Access denied. The stream may require valid credentials or headers.';
        } else if (error.includes('404') || error.includes('Not Found')) {
            userMessage =
                'Stream not found. The URL may be incorrect or expired.';
        } else if (error.includes('Timed out') || error.includes('timeout')) {
            userMessage = 'Connection timed out. The server is not responding.';
        }

        App.mainWindow.webContents.send('player-error', {
            player,
            error: userMessage,
            originalError: error,
        });
    }
}

function sendPlaybackPositionUpdate(
    sessionId: string,
    contentInfo: any,
    snapshot: ExternalPlaybackSnapshot
) {
    if (!App.mainWindow || App.mainWindow.isDestroyed()) {
        return;
    }

    externalPlayerSessions.markPlaying(sessionId);
    App.mainWindow.webContents.send('playback-position-update', {
        sessionId,
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        ...contentInfo,
    });
}

// Query MPV property via IPC
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
            // console.log('[PlayerEvents] MPV IPC connected, sending:', request.trim());
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
                } catch (e) {
                    // ignore parse errors
                }
            }
        });

        client.on('end', () => {
            clearTimeout(timeoutHandle);
            // Fallback if no newline was detected but connection closed
            if (data && !data.includes('\n')) {
                try {
                    const response = JSON.parse(data);
                    resolve(response.data ?? null);
                } catch (e) {
                    resolve(null);
                }
            }
        });

        client.on('error', (err) => {
            clearTimeout(timeoutHandle);
            resolve(null);
        });
    });
}

export function parseVlcRcNumericResponse(data: string): string {
    const match = data.match(/>\s*(-?\d+(?:\.\d+)?)/);
    return match ? match[1] : '';
}

export function parseVlcRcPlaybackState(data: string): string | null {
    const match = data.match(/\(\s*state\s+([^)]+)\s*\)/i);
    return match ? match[1].trim().toLowerCase() : null;
}

function stopPositionPolling() {
    if (positionPollingInterval) {
        clearInterval(positionPollingInterval);
        positionPollingInterval = null;
    }
}

function maskUrlForLogs(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return rawUrl;
    }
}

function shouldIgnoreMpvStdoutLine(line: string): boolean {
    // Suppress MPV realtime progress spam.
    return /^(\(Paused\)\s*)?AV:\s/.test(line);
}

function buildHttpHeaderFields(
    origin?: string,
    headers?: Record<string, string>
): string[] {
    const fields: string[] = [];
    const normalizedHeaders = headers ?? {};

    if (
        origin &&
        normalizedHeaders['Origin'] === undefined &&
        normalizedHeaders['origin'] === undefined
    ) {
        fields.push(`Origin: ${origin}`);
    }

    Object.entries(normalizedHeaders).forEach(([name, value]) => {
        if (!name || value === undefined || value === null) return;
        const trimmedValue = String(value).trim();
        if (!trimmedValue) return;
        fields.push(`${name}: ${trimmedValue}`);
    });

    return fields;
}

function isStalkerDirectStreamProfile(
    headers: Record<string, string>
): boolean {
    const icyMetaData = headers['Icy-MetaData'] ?? headers['icy-metadata'];
    const userAgent = headers['User-Agent'] ?? headers['user-agent'];

    return (
        String(icyMetaData).trim() === '1' &&
        String(userAgent).trim().toLowerCase() === 'ksplayer'
    );
}

function startPositionPolling(
    socketPath: string,
    contentInfo: any,
    sessionId: string
) {
    stopPositionPolling();

    // Initial delay to let video load
    setTimeout(() => {
        // console.log('[PlayerEvents] Starting position polling interval');
        positionPollingInterval = setInterval(async () => {
            try {
                const position = await getMpvProperty(socketPath, 'time-pos');
                const duration = await getMpvProperty(socketPath, 'duration');

                // console.log(`[PlayerEvents] Polling MPV: pos=${position}, dur=${duration}`);

                if (position !== null && App.mainWindow) {
                    sendPlaybackPositionUpdate(sessionId, contentInfo, {
                        positionSeconds: Math.floor(position),
                        durationSeconds: duration ? Math.floor(duration) : null,
                    });
                }
            } catch (err) {
                // console.error('[PlayerEvents] Error during polling:', err);
                // MPV may have closed, stop polling
                stopPositionPolling();
            }
        }, 5000); // Changed to 5 seconds for debugging
    }, 2000); // Reduced initial delay
}

// VLC Polling
let vlcPollingInterval: NodeJS.Timeout | null = null;

function stopVlcPositionPolling() {
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
            // VLC prompt '>' means command finished
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
    contentInfo: any,
    sessionId: string,
    onSnapshot?: (snapshot: ExternalPlaybackSnapshot) => void,
    onStopped?: () => void
) {
    stopVlcPositionPolling();

    // VLC needs time to start and bind port
    setTimeout(() => {
        /*
        console.log(
            `[PlayerEvents] Starting VLC polling on port ${port}`,
            contentInfo
        );
        */
        vlcPollingInterval = setInterval(async () => {
            try {
                const snapshot = await getVlcPlaybackSnapshot(port);

                if (snapshot && App.mainWindow) {
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
            } catch (err) {
                // console.error('[PlayerEvents] VLC polling error:', err);
                stopVlcPositionPolling();
            }
        }, 2000);
    }, 1500);
}

// Helper function to send command to MPV via IPC
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
        // MPV expects commands in the format: { "command": ["cmd", "arg1", "arg2"] }
        const request = JSON.stringify({ command: [command, ...args] }) + '\n';

        client.on('connect', () => {
            console.log('Connected to MPV socket, sending command:', request);
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

ipcMain.handle(
    'OPEN_MPV_PLAYER',
    async (
        event,
        url: string,
        title: string,
        thumbnail?: string,
        userAgent?: string,
        referer?: string,
        origin?: string,
        contentInfo?: any,
        startTime?: number,
        headers?: Record<string, string>
    ) => {
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
            const fallbackHeaders = getStalkerPlaybackContextHeaders(url) ?? {};
            const mergedHeaders = isStalkerDirectStreamProfile(fallbackHeaders)
                ? fallbackHeaders
                : {
                      ...fallbackHeaders,
                      ...(headers ?? {}),
                  };
            const effectiveOrigin =
                origin ??
                mergedHeaders['Origin'] ??
                mergedHeaders['origin'] ??
                undefined;
            const effectiveReferer =
                referer ??
                mergedHeaders['Referer'] ??
                mergedHeaders['referer'] ??
                undefined;
            const effectiveUserAgent =
                userAgent ??
                mergedHeaders['User-Agent'] ??
                mergedHeaders['user-agent'] ??
                undefined;
            const headerFields = buildHttpHeaderFields(
                effectiveOrigin,
                mergedHeaders
            );

            console.log('[MPV] Opening player', {
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

            // If reuse is enabled and there's an existing process, try to use it
            if (
                reuseInstance &&
                mpvProcess &&
                !mpvProcess.killed &&
                mpvSocketPath
            ) {
                console.log('Reusing existing MPV instance');
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

                    const loadFileArgs: Array<string | number> = [
                        url,
                        'replace',
                    ];
                    const loadFileOptions: string[] = [];

                    // loadfile args are: url, flags, index, options
                    // Index must be numeric; options are a comma-separated key=value list.
                    if (title) {
                        loadFileOptions.push(`force-media-title=${title}`);
                    }
                    if (loadFileOptions.length > 0) {
                        loadFileArgs.push(-1, loadFileOptions.join(','));
                    }

                    await sendMpvCommand('loadfile', loadFileArgs);
                    console.log(
                        'Successfully loaded new URL in existing MPV instance'
                    );

                    externalPlayerSessions.attachCloser(
                        session.id,
                        async () => {
                            try {
                                await sendMpvCommand('quit', []);
                            } catch {
                                if (mpvProcess && !mpvProcess.killed) {
                                    mpvProcess.kill();
                                }
                            }
                        }
                    );

                    // Seek if startTime provided
                    if (startTime) {
                        await sendMpvCommand('seek', [
                            String(startTime),
                            'absolute',
                        ]);
                    }

                    // Restart polling with new content info
                    if (contentInfo) {
                        startPositionPolling(
                            mpvSocketPath,
                            contentInfo,
                            session.id
                        );
                    } else {
                        stopPositionPolling();
                    }

                    return (
                        externalPlayerSessions.markOpened(session.id) ?? session
                    );
                } catch (err) {
                    console.error(
                        'Failed to send command to existing MPV:',
                        err
                    );
                    // If it fails, clear the reference and create a new one
                    mpvProcess = null;
                    mpvSocketPath = null;
                    stopPositionPolling();
                    // Fall through to create new instance
                }
            }

            // Create new MPV process
            console.log('Creating new MPV instance');

            let socketPath: string | null = null;
            const args: string[] = [];

            if (useMpvSocketBridge) {
                socketPath =
                    process.platform === 'win32'
                        ? `\\\\.\\pipe\\mpv-${Date.now()}`
                        : `/tmp/mpvsocket-${Date.now()}`;
                args.push(`--input-ipc-server=${socketPath}`, '--idle=yes');
            }

            // IPTV URLs often look like generic web pages to ytdl_hook and can fail with 403.
            // Force MPV to open them directly instead of probing via yt-dlp/youtube-dl.
            args.push('--ytdl=no');

            // Add user agent if provided
            if (effectiveUserAgent) {
                args.push(`--user-agent=${effectiveUserAgent}`);
            }

            // Add referer if provided
            if (effectiveReferer) {
                args.push(`--referrer=${effectiveReferer}`);
            }

            if (headerFields.length > 0) {
                args.push(`--http-header-fields=${headerFields.join(',')}`);
            }

            // Add title if provided
            if (title) {
                args.push(`--force-media-title=${title}`);
            }

            // Add start time if provided
            if (startTime) {
                args.push(`--start=${startTime}`);
            }

            // Add URL last
            args.push(url);

            // Wrap spawn in a promise to catch startup errors
            await new Promise<void>((resolve, reject) => {
                const spawnSpec = buildExternalPlayerSpawnSpec(
                    mpvLaunchContext,
                    buildPlayerArgsWithCustomArguments(customMpvArguments, args)
                );
                const proc = spawn(spawnSpec.command, spawnSpec.args, {
                    shell: false,
                    detached: !reuseInstance,
                    // Only pipe stdio when reusing instance; use 'ignore' for detached to allow clean shutdown
                    stdio: reuseInstance
                        ? ['ignore', 'pipe', 'pipe']
                        : 'ignore',
                });

                // Capture stdout
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

                            console.log('[MPV stdout]:', output);

                            // MPV sometimes outputs errors to stdout instead of stderr
                            if (
                                output.includes('Failed to open') ||
                                output.includes('Error opening') ||
                                output.includes('Protocol not found') ||
                                output.includes('Connection refused') ||
                                output.includes('error') ||
                                output.includes('403') ||
                                output.includes('404')
                            ) {
                                console.error(
                                    '[MPV ERROR from stdout]:',
                                    output
                                );
                                sendPlayerErrorNotification('MPV', output);
                            }
                        }
                    });
                }

                // Capture stderr (MPV outputs most messages here)
                if (proc.stderr) {
                    proc.stderr.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            console.error('[MPV stderr]:', output);

                            // Check for common error patterns and send notifications
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
                    console.log(`MPV exited with code ${code}`);
                    mpvProcess = null;
                    mpvSocketPath = null;
                    stopPositionPolling();

                    // Log non-zero exit codes as errors and notify user
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

                // Store the process reference if reuse is enabled
                if (reuseInstance && socketPath) {
                    mpvProcess = proc;
                    mpvSocketPath = socketPath;
                    console.log(
                        'Stored MPV process for reuse with socket:',
                        socketPath
                    );
                } else {
                    // Detach the process so it can continue running independently
                    proc.unref();
                }

                externalPlayerSessions.attachCloser(session.id, async () => {
                    if (!proc.killed) {
                        proc.kill();
                    }
                });

                // Start polling if content info is provided
                if (useMpvSocketBridge && contentInfo && socketPath) {
                    startPositionPolling(socketPath, contentInfo, session.id);
                }

                // Resolve immediately if spawn succeeds (error event would fire if it fails)
                // Give a small window to catch immediate spawn errors
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
);

ipcMain.handle(
    'SET_MPV_PLAYER_PATH',
    (_event, mpvPlayerPath: string | null | undefined) => {
        const normalizedPlayerPath = normalizePlayerPathForStore(mpvPlayerPath);
        console.log('... setting mpv player path', normalizedPlayerPath);
        store.set(MPV_PLAYER_PATH, normalizedPlayerPath);
    }
);

ipcMain.handle('SET_MPV_REUSE_INSTANCE', (_event, reuseInstance: boolean) => {
    console.log('... setting mpv reuse instance', reuseInstance);
    store.set(MPV_REUSE_INSTANCE, reuseInstance);

    // If disabling reuse, kill the existing process
    if (!reuseInstance && mpvProcess && !mpvProcess.killed) {
        console.log('Disabling reuse, cleaning up existing MPV process');
        mpvProcess.kill();
        mpvProcess = null;
        mpvSocketPath = null;
    }
});

ipcMain.handle(
    'OPEN_VLC_PLAYER',
    async (
        event,
        url: string,
        title: string,
        thumbnail?: string,
        userAgent?: string,
        referer?: string,
        origin?: string,
        contentInfo?: any,
        startTime?: number,
        headers?: Record<string, string>
    ) => {
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
            const fallbackHeaders = getStalkerPlaybackContextHeaders(url) ?? {};
            const mergedHeaders = isStalkerDirectStreamProfile(fallbackHeaders)
                ? fallbackHeaders
                : {
                      ...fallbackHeaders,
                      ...(headers ?? {}),
                  };
            const effectiveOrigin =
                origin ??
                mergedHeaders['Origin'] ??
                mergedHeaders['origin'] ??
                undefined;
            const effectiveReferer =
                referer ??
                mergedHeaders['Referer'] ??
                mergedHeaders['referer'] ??
                undefined;
            const effectiveUserAgent =
                userAgent ??
                mergedHeaders['User-Agent'] ??
                mergedHeaders['user-agent'] ??
                undefined;
            console.log('[VLC] Opening player', {
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

            // Try to drive an already-running VLC via its RC port instead of
            // spawning a new instance.
            if (
                reuseInstance &&
                vlcProcess &&
                !vlcProcess.killed &&
                vlcRcPort
            ) {
                console.log(
                    'Reusing existing VLC instance on RC port',
                    vlcRcPort
                );
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
                    console.log(
                        'Successfully loaded new URL in existing VLC instance'
                    );

                    const reusedRcPort = vlcRcPort;
                    let lastReusedSnapshot: ExternalPlaybackSnapshot | null =
                        null;
                    externalPlayerSessions.attachCloser(
                        session.id,
                        async () => {
                            try {
                                await sendVlcRcCommand(reusedRcPort, 'stop');
                            } catch {
                                if (vlcProcess && !vlcProcess.killed) {
                                    vlcProcess.kill();
                                }
                            }
                        }
                    );

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
                                    contentInfo &&
                                    externalPlayerSessions.getSession(
                                        session.id
                                    )?.status !== 'closed'
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

                    return (
                        externalPlayerSessions.markOpened(session.id) ?? session
                    );
                } catch (err) {
                    console.error(
                        'Failed to reuse existing VLC, spawning fresh:',
                        err
                    );
                    // Tracked process is not responsive; clear state and fall
                    // through to spawn a brand new VLC.
                    if (vlcProcess && !vlcProcess.killed) {
                        try {
                            vlcProcess.kill();
                        } catch {
                            /* ignore */
                        }
                    }
                    vlcProcess = null;
                    vlcRcPort = null;
                    stopVlcPositionPolling();
                }
            }

            // Get free port for RC interface (always allocate when reuse is
            // enabled so future calls can drive this instance).
            let rcPort = 0;
            if (contentInfo || reuseInstance) {
                try {
                    rcPort = await getFreePort();
                    console.log('Using VLC RC port:', rcPort);
                } catch (e) {
                    console.error('Failed to get free port for VLC:', e);
                }
            }

            const args: string[] = [];

            if (rcPort > 0) {
                args.push('--extraintf=rc');
                args.push(`--rc-host=127.0.0.1:${rcPort}`);
                // args.push('--rc-quiet'); // Suppress status messages in stdout
            }

            // Add user agent if provided (VLC uses :http-user-agent= format)
            if (effectiveUserAgent) {
                args.push(`:http-user-agent=${effectiveUserAgent}`);
            }

            // Add referer if provided (VLC uses :http-referrer= format)
            if (effectiveReferer) {
                args.push(`:http-referrer=${effectiveReferer}`);
            }

            // Note: VLC doesn't have a direct origin option, but origin is typically
            // included in referer for most IPTV use cases
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

            // Add start time if provided
            if (startTime) {
                args.push(`--start-time=${startTime}`);
            }

            // Add URL and per-input options last
            args.push(url);
            if (title) {
                args.push(`:meta-title=${title}`);
            }

            console.log('VLC Args:', args);
            let lastVlcSnapshot: ExternalPlaybackSnapshot | null = null;

            // Wrap spawn in a promise to catch startup errors
            await new Promise<void>((resolve, reject) => {
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
                        stdio: trackProcess
                            ? ['ignore', 'pipe', 'pipe']
                            : 'ignore',
                    });

                    if (trackProcess && rcPort > 0) {
                        vlcProcess = proc;
                        vlcRcPort = rcPort;
                        console.log(
                            'Tracking VLC process for reuse on RC port',
                            rcPort
                        );
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

                    externalPlayerSessions.attachCloser(
                        session.id,
                        async () => {
                            await flushVlcPlaybackPosition();
                            if (!proc.killed) {
                                proc.kill();
                            }
                        }
                    );

                    // Start polling if we have port and content info and NOT retrying (RC disabled on retry)
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

                    // Capture stdout
                    if (proc.stdout) {
                        proc.stdout.on('data', (data) => {
                            const output = data.toString().trim();
                            if (output) {
                                console.log('[VLC stdout]:', output);
                            }
                        });
                    }

                    // Capture stderr
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
                            console.log('Retrying VLC without RC interface...');
                            // Retry without RC args
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
                            reject(
                                buildPlayerStartError(
                                    'VLC',
                                    err,
                                    vlcLaunchContext
                                )
                            );
                        }
                    });

                    proc.on('exit', (code) => {
                        console.log(`VLC exited with code ${code}`);
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
                            console.log(
                                'VLC exited with error, retrying without RC interface...'
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

                        // Log non-zero exit codes as errors and notify user
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
                resolve();
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
);

ipcMain.handle(
    'SET_VLC_PLAYER_PATH',
    (_event, vlcPlayerPath: string | null | undefined) => {
        const normalizedPlayerPath = normalizePlayerPathForStore(vlcPlayerPath);
        console.log('... setting vlc player path', normalizedPlayerPath);
        store.set(VLC_PLAYER_PATH, normalizedPlayerPath);
    }
);

ipcMain.handle('SET_VLC_REUSE_INSTANCE', (_event, reuseInstance: boolean) => {
    console.log('... setting vlc reuse instance', reuseInstance);
    store.set(VLC_REUSE_INSTANCE, reuseInstance);

    // If disabling reuse, kill the existing tracked process
    if (!reuseInstance && vlcProcess && !vlcProcess.killed) {
        console.log('Disabling reuse, cleaning up existing VLC process');
        vlcProcess.kill();
        vlcProcess = null;
        vlcRcPort = null;
    }
});

ipcMain.handle(
    CLOSE_EXTERNAL_PLAYER_SESSION,
    async (_event, sessionId: string) => {
        return externalPlayerSessions.closeSession(sessionId);
    }
);

function getMpvPath(options: PlayerPathOptions = {}) {
    return (
        normalizeCustomPlayerPath(store.get(MPV_PLAYER_PATH)) ??
        getDefaultMpvPath(options)
    );
}

function getVlcPath(options: PlayerPathOptions = {}) {
    return (
        normalizeCustomPlayerPath(store.get(VLC_PLAYER_PATH)) ??
        getDefaultVlcPath(options)
    );
}

function getDefaultMpvPath(options: PlayerPathOptions = {}) {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
    } = options;

    if (platform === 'linux' && isFlatpak) {
        return 'mpv';
    }

    if (platform === 'win32') {
        // Check multiple common Windows paths
        const windowsPaths = [
            path.join('C:', 'Program Files', 'mpv', 'mpv.exe'),
            path.join('C:', 'Program Files (x86)', 'mpv', 'mpv.exe'),
        ];

        // Check if any of the paths exist
        for (const mpvPath of windowsPaths) {
            if (pathExists(mpvPath)) {
                return mpvPath;
            }
        }
        // Default to just 'mpv' if it's in PATH
        return 'mpv';
    } else if (platform === 'linux') {
        // Check multiple common Linux paths
        const linuxPaths = [
            '/usr/bin/mpv',
            '/usr/local/bin/mpv',
            '/snap/bin/mpv',
        ];

        for (const mpvPath of linuxPaths) {
            if (pathExists(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    } else if (platform === 'darwin') {
        // Check multiple common macOS paths
        const macosPaths = [
            '/Applications/mpv.app/Contents/MacOS/mpv',
            '/opt/homebrew/bin/mpv',
            '/usr/local/bin/mpv',
        ];

        for (const mpvPath of macosPaths) {
            if (pathExists(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    }

    // Fallback to just 'mpv' hoping it's in PATH
    return 'mpv';
}

function getDefaultVlcPath(options: PlayerPathOptions = {}) {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
    } = options;

    if (platform === 'linux' && isFlatpak) {
        return 'vlc';
    }

    if (platform === 'win32') {
        // Check multiple common Windows paths (64-bit and 32-bit)
        const windowsPaths = [
            path.join('C:', 'Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
            path.join(
                'C:',
                'Program Files (x86)',
                'VideoLAN',
                'VLC',
                'vlc.exe'
            ),
        ];

        for (const vlcPath of windowsPaths) {
            if (pathExists(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    } else if (platform === 'linux') {
        // Check multiple common Linux paths
        const linuxPaths = [
            '/usr/bin/vlc',
            '/usr/local/bin/vlc',
            '/snap/bin/vlc',
        ];

        for (const vlcPath of linuxPaths) {
            if (pathExists(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    } else if (platform === 'darwin') {
        // Check multiple common macOS paths
        const macosPaths = [
            '/Applications/VLC.app/Contents/MacOS/VLC',
            '/opt/homebrew/Caskroom/vlc/*/VLC.app/Contents/MacOS/VLC',
        ];

        for (const vlcPath of macosPaths) {
            if (pathExists(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    }
    return 'vlc';
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

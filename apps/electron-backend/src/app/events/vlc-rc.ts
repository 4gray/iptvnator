import { createConnection } from 'net';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildHttpHeaderFields } from './external-player-playback-request';
import {
    ExternalPlaybackSnapshot,
    externalPlayerSessions,
} from './external-player-runtime';
import { markExternalPlayerOpened } from './external-player-idle-monitor';
import {
    matchVlcGuidePlaylist,
    matchesVlcInput,
    type VlcGuidePlaylistRequest,
} from './vlc-guide-playlist';

export type VlcRcAddress = number | string;

function connectVlc(address: VlcRcAddress) {
    return typeof address === 'string'
        ? createConnection(address)
        : createConnection({ port: address, host: '127.0.0.1' });
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

    // The reused process was launched with a global `--start-time=<resume>`,
    // which VLC applies to every later input too. A per-input start time (0
    // when nothing is resumed) keeps each item at its own offset.
    const startTime =
        typeof options.startTime === 'number' &&
        Number.isFinite(options.startTime) &&
        options.startTime >= 0
            ? Math.floor(options.startTime)
            : 0;
    inputOptions.push(`:start-time=${startTime}`);

    if (options.userAgent) {
        inputOptions.push(`:http-user-agent=${options.userAgent}`);
    }
    if (options.referer) {
        inputOptions.push(`:http-referrer=${options.referer}`);
    } else if (options.origin) {
        inputOptions.push(`:http-referrer=${options.origin}`);
    }
    // Same field list MPV sends: a real `Origin: ...` header (unless the
    // headers map already carries one) plus every non-empty custom header.
    buildHttpHeaderFields(options.origin, options.headers).forEach((field) => {
        inputOptions.push(`:http-header=${field}`);
    });
    if (options.title) {
        inputOptions.push(`:meta-title=${options.title}`);
    }

    const inputLine =
        inputOptions.length > 0
            ? `${options.url} ${inputOptions.join(' ')}`
            : options.url;
    const commands = ['clear', `add ${inputLine}`];
    if (startTime > 0) {
        commands.push(`seek ${startTime}`);
    }
    return commands;
}

export function sendVlcRcCommand(
    port: VlcRcAddress,
    command: string,
    onDispatched?: () => void,
    shouldDispatch?: () => boolean
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const client = connectVlc(port);
        let settled = false;
        let response = '';
        const commandName = command.split(' ', 1)[0];
        const finish = (error?: Error, dispatched = true) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            if (!client.destroyed) client.destroy();
            if (error) reject(error);
            else resolve(dispatched);
        };
        const timeoutHandle = setTimeout(
            () => finish(new Error('VLC RC command timed out')),
            2_000
        );

        client.on('connect', () => {
            try {
                if (shouldDispatch && !shouldDispatch()) {
                    finish(undefined, false);
                    return;
                }
                client.write(`${command}\n`);
                onDispatched?.();
            } catch (error) {
                finish(
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
        client.on('data', (chunk) => {
            if (typeof port !== 'string') {
                if (chunk.toString().includes('>')) finish();
                return;
            }
            response += chunk.toString();
            const result = legacyCommandResult(response, commandName);
            if (result !== undefined)
                finish(
                    result === 0
                        ? undefined
                        : new Error('VLC RC command failed')
                );
        });
        client.on('error', (error) => finish(error));
    });
}

export async function sendVlcRcCommands(
    port: VlcRcAddress,
    commands: string[],
    onClearSent: () => void,
    onCleared: () => void,
    shouldDispatch: (index: number) => boolean
): Promise<void> {
    for (const [index, command] of commands.entries()) {
        const canDispatch = () => shouldDispatch(index);
        if (!canDispatch()) return;
        const dispatched = await sendVlcRcCommand(
            port,
            command,
            index === 0
                ? () => {
                      onClearSent();
                      if (typeof port === 'number') onCleared();
                  }
                : undefined,
            canDispatch
        );
        if (!dispatched) return;
        if (index === 0 && typeof port === 'string') {
            const cleared = await waitForVlcClear(port, canDispatch);
            if (!canDispatch()) return;
            if (!cleared)
                throw new Error('VLC did not clear its previous input');
            onCleared();
        }
    }
}

async function waitForVlcClear(
    port: string,
    canDispatch: () => boolean
): Promise<boolean> {
    const deadline = Date.now() + 350;
    while (canDispatch() && Date.now() < deadline) {
        // oldrc acknowledges clear before teardown finishes, or ignores it on pause.
        const status = await getVlcCommandResponse(
            port,
            'status',
            undefined,
            deadline - Date.now()
        );
        const state = parseVlcRcPlaybackState(status);
        if (!state) return false;
        if (state === 'stopped' && !readVlcInput(status)) return true;
        await sleep(Math.min(50, Math.max(0, deadline - Date.now())));
    }
    return false;
}

export function markVlcInputUnverified(sessionId: string): void {
    externalPlayerSessions.updateSession(sessionId, {
        mediaLoaded: false,
        playbackIdle: undefined,
        playbackUnverified: true,
    });
}

export function parseVlcRcNumericResponse(data: string): string {
    return data.match(/>\s*(-?\d+(?:\.\d+)?)/)?.[1] ?? '';
}

function parseVlcRcNumericLine(data: string): string | undefined {
    return data.match(/^[> \t]*(-?\d+(?:\.\d+)?)[ \t]*\r?\n/m)?.[1];
}

function legacyCommandResult(
    response: string,
    command: string
): number | undefined {
    const result = response
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${command}: returned `));
    const code = result?.match(/: returned (-?\d+) \(/)?.[1];
    return code === undefined ? undefined : Number(code);
}

export function parseVlcRcPlaybackState(data: string): string | null {
    const legacy = Array.from(
        data.matchAll(/\(\s*(play|pause|stop|unknown)\s+state:\s*-?\d+\s*\)/gi)
    )
        .at(-1)?.[1]
        ?.toLowerCase();
    if (legacy === 'play') return 'playing';
    if (legacy === 'pause') return 'paused';
    if (legacy === 'stop') return 'stopped';
    return (
        data
            .match(/\(\s*state\s+([^)]+)\s*\)/i)?.[1]
            ?.trim()
            .toLowerCase() ??
        legacy ??
        null
    );
}

function getVlcCommandResponse(
    port: VlcRcAddress,
    command: string,
    complete?: (data: string) => boolean,
    timeoutMs = 2_000
): Promise<string> {
    return new Promise((resolve) => {
        const client = connectVlc(port);
        let data = '';
        const unixStatus = command === 'status' && typeof port === 'string';
        let settled = false;
        const finish = (result: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            if (!client.destroyed) client.destroy();
            resolve(result);
        };
        const timeoutHandle = setTimeout(() => finish(''), timeoutMs);

        client.on('connect', () => client.write(`${command}\n`));
        client.on('data', (chunk) => {
            data += chunk.toString();
            const received =
                complete?.(data) ??
                (command === 'status'
                    ? unixStatus
                        ? legacyCommandResult(data, command) !== undefined
                        : parseVlcRcPlaybackState(data) !== null
                    : data.includes('>'));
            if (received)
                finish(
                    !unixStatus
                        ? data
                        : legacyCommandResult(data, command) === 0
                          ? data.split(/^status: returned /m, 1)[0]
                          : ''
                );
        });
        client.on('error', () => finish(''));
    });
}

export async function getVlcPlaybackState(
    port: VlcRcAddress
): Promise<string | null> {
    return parseVlcRcPlaybackState(await getVlcCommandResponse(port, 'status'));
}

function readVlcInput(response: string): string | undefined {
    return Array.from(
        response.matchAll(/\(\s*new input:[ \t]*([^\r\n]+)\)[ \t]*\r?$/gim)
    )
        .at(-1)?.[1]
        ?.trim();
}

export function markVlcOpened(
    sessionId: string,
    getPort: () => VlcRcAddress,
    request: VlcGuidePlaylistRequest,
    reuseInstance: boolean
) {
    const session = externalPlayerSessions.getSession(sessionId);
    const mediaUrl =
        session?.launchId && !session.contentInfo
            ? session.streamUrl
            : undefined;
    const port = getPort();
    if (mediaUrl && session?.status === 'launching')
        externalPlayerSessions.updateSession(sessionId, {
            reuseAvailable: reuseInstance && typeof port === 'string',
            mediaLoaded: false,
            playbackUnverified: port ? undefined : true,
            mediaObservationUnavailable: port ? undefined : true,
        });
    if (!port) return markExternalPlayerOpened(sessionId);
    const listedChild = mediaUrl && matchVlcGuidePlaylist(mediaUrl, request);
    let playlistInput: string | undefined;
    let confirmedDirectInput = false;
    let playedRequestedMedia = false;
    if (mediaUrl)
        setTimeout(() => {
            const current = externalPlayerSessions.getSession(sessionId);
            if (
                getPort() === port &&
                current?.mediaLoaded === false &&
                (current.status === 'opened' || current.status === 'playing')
            )
                externalPlayerSessions.updateSession(sessionId, {
                    mediaReadinessTimedOut: true,
                    playbackUnverified: true,
                });
        }, 30_000).unref();
    return markExternalPlayerOpened(
        sessionId,
        async (isCurrent) => {
            const port = getPort();
            if (!port) return undefined;
            const canRead = () => isCurrent() && getPort() === port;
            const response = await getVlcCommandResponse(port, 'status');
            const state = parseVlcRcPlaybackState(response);
            if (!canRead()) return undefined;
            if (
                mediaUrl &&
                state === 'stopped' &&
                externalPlayerSessions.getSession(sessionId)?.mediaLoaded
            )
                externalPlayerSessions.updateSession(sessionId, {
                    mediaLoaded: false,
                    playbackIdle: true,
                });
            if (mediaUrl && (state === 'playing' || state === 'paused')) {
                const input = readVlcInput(response);
                if (!input) return null;
                const confirmed =
                    externalPlayerSessions.getSession(sessionId)?.mediaLoaded;
                if (!confirmed) {
                    const clock = await getVlcCommandResponse(
                        port,
                        'get_time',
                        (data) => parseVlcRcNumericLine(data) !== undefined
                    );
                    if (!canRead()) return undefined;
                    const elapsed = parseVlcRcNumericLine(clock);
                    if (elapsed === undefined) return null;
                    if (Number(elapsed) <= 0) return false;
                }
                const directInput = matchesVlcInput(input, mediaUrl);
                const knownInput = directInput || input === playlistInput;
                let matches =
                    knownInput ||
                    !!(
                        !confirmedDirectInput &&
                        listedChild &&
                        (await listedChild(input))
                    );
                if (!canRead()) return undefined;
                if (matches && (!confirmed || !knownInput)) {
                    const latest = await getVlcCommandResponse(port, 'status');
                    const latestState = parseVlcRcPlaybackState(latest);
                    matches =
                        readVlcInput(latest) === input &&
                        (latestState === 'playing' || latestState === 'paused');
                    if (matches && !knownInput) playlistInput = input;
                }
                if (!canRead()) return undefined;
                if (confirmed && !matches)
                    externalPlayerSessions.updateSession(sessionId, {
                        mediaLoaded: false,
                        playbackIdle: false,
                        playbackUnverified: true,
                    });
                if (!matches) return null;
                if (directInput) confirmedDirectInput = true;
                if (!confirmed) {
                    playedRequestedMedia = true;
                    externalPlayerSessions.updateSession(sessionId, {
                        mediaLoaded: true,
                        playbackIdle: false,
                        playbackUnverified: undefined,
                        mediaReadinessTimedOut: undefined,
                    });
                }
            }
            return state === 'stopped'
                ? !mediaUrl || playedRequestedMedia
                : state === 'playing' || state === 'paused'
                  ? false
                  : null;
        },
        true
    );
}

export async function getVlcPlaybackSnapshot(
    port: VlcRcAddress
): Promise<ExternalPlaybackSnapshot | null> {
    const legacy = typeof port === 'string';
    const parse = legacy ? parseVlcRcNumericLine : parseVlcRcNumericResponse;
    const complete = legacy
        ? (data: string) => parseVlcRcNumericLine(data) !== undefined
        : undefined;
    const time = parseInt(
        parse(await getVlcCommandResponse(port, 'get_time', complete)) ?? '',
        10
    );
    const duration = parseInt(
        parse(await getVlcCommandResponse(port, 'get_length', complete)) ?? '',
        10
    );
    if (Number.isNaN(time) || (legacy && time === 0 && duration === 0))
        return null;
    return {
        positionSeconds: time,
        durationSeconds: Number.isNaN(duration) ? null : duration,
    };
}

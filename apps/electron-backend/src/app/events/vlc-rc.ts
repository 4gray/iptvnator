import { createConnection } from 'net';
import { buildHttpHeaderFields } from './external-player-playback-request';
import {
    ExternalPlaybackSnapshot,
    externalPlayerSessions,
} from './external-player-runtime';
import { markExternalPlayerOpened } from './external-player-idle-monitor';

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
    port: number,
    command: string,
    onDispatched?: () => void,
    shouldDispatch?: () => boolean
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const client = createConnection({ port, host: '127.0.0.1' });
        let settled = false;
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
            if (chunk.toString().includes('>')) finish();
        });
        client.on('error', (error) => finish(error));
    });
}

export async function sendVlcRcCommands(
    port: number,
    commands: string[],
    onCommandSent?: (command: string, index: number) => void,
    shouldDispatch?: (index: number) => boolean
): Promise<void> {
    for (const [index, command] of commands.entries()) {
        const canDispatch = () => shouldDispatch?.(index) ?? true;
        if (!canDispatch()) return;
        const dispatched = await sendVlcRcCommand(
            port,
            command,
            () => onCommandSent?.(command, index),
            canDispatch
        );
        if (!dispatched) return;
    }
}

export function parseVlcRcNumericResponse(data: string): string {
    return data.match(/>\s*(-?\d+(?:\.\d+)?)/)?.[1] ?? '';
}

export function parseVlcRcPlaybackState(data: string): string | null {
    const legacy = data
        .match(/\(\s*(play|pause|stop|unknown)\s+state:\s*-?\d+\s*\)/i)?.[1]
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
    port: number,
    command: string,
    complete?: (data: string) => boolean
): Promise<string> {
    return new Promise((resolve) => {
        const client = createConnection({ port, host: '127.0.0.1' });
        let data = '';
        let settled = false;
        const finish = (result: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            if (!client.destroyed) client.destroy();
            resolve(result);
        };
        const timeoutHandle = setTimeout(() => finish(''), 2_000);

        client.on('connect', () => client.write(`${command}\n`));
        client.on('data', (chunk) => {
            data += chunk.toString();
            const received =
                complete?.(data) ??
                (command === 'status'
                    ? parseVlcRcPlaybackState(data) !== null
                    : data.includes('>'));
            if (received) finish(data);
        });
        client.on('error', () => finish(''));
    });
}

export async function getVlcPlaybackState(
    port: number
): Promise<string | null> {
    return parseVlcRcPlaybackState(await getVlcCommandResponse(port, 'status'));
}

export function markVlcOpened(sessionId: string, getPort: () => number) {
    const session = externalPlayerSessions.getSession(sessionId);
    const mediaUrl =
        session?.launchId && !session.contentInfo
            ? session.streamUrl
            : undefined;
    const port = getPort();
    if (mediaUrl && session?.status === 'launching')
        externalPlayerSessions.updateSession(sessionId, {
            mediaLoaded: false,
            playbackUnverified: port ? undefined : true,
        });
    if (!port) return markExternalPlayerOpened(sessionId);
    return markExternalPlayerOpened(
        sessionId,
        async () => {
            const port = getPort();
            if (!port) return undefined;
            const response = await getVlcCommandResponse(port, 'status');
            const state = parseVlcRcPlaybackState(response);
            if (getPort() !== port) return undefined;
            if (
                mediaUrl &&
                (state === 'playing' || state === 'paused') &&
                externalPlayerSessions.getSession(sessionId)?.mediaLoaded ===
                    false
            ) {
                const input = response
                    .match(
                        /\(\s*new input:[ \t]*([^\r\n]+)\)[ \t]*(?:\r?\n|$)/i
                    )?.[1]
                    ?.trim();
                if (!matchesVlcInput(input, mediaUrl))
                    return input ? false : null;
                const parseTime = (data: string) =>
                    data.match(/^[> \t]*(-?\d+(?:\.\d+)?)[ \t]*\r?$/m)?.[1];
                const clock = await getVlcCommandResponse(
                    port,
                    'get_time',
                    (data) => parseTime(data) !== undefined
                );
                if (getPort() !== port) return undefined;
                const elapsed = parseTime(clock);
                if (elapsed === undefined) return null;
                if (Number(elapsed) <= 0) return false;
                externalPlayerSessions.updateSession(sessionId, {
                    mediaLoaded: true,
                    playbackIdle: false,
                    playbackUnverified: undefined,
                });
            }
            return state === 'stopped'
                ? true
                : state === 'playing' || state === 'paused'
                  ? false
                  : null;
        },
        true
    );
}

function matchesVlcInput(
    input: string | undefined,
    streamUrl: string
): boolean {
    if (input === streamUrl) return true;
    try {
        return input === decodeURIComponent(streamUrl);
    } catch {
        return false;
    }
}

export async function getVlcPlaybackSnapshot(
    port: number
): Promise<ExternalPlaybackSnapshot | null> {
    const time = parseInt(
        parseVlcRcNumericResponse(
            await getVlcCommandResponse(port, 'get_time')
        ),
        10
    );
    const duration = parseInt(
        parseVlcRcNumericResponse(
            await getVlcCommandResponse(port, 'get_length')
        ),
        10
    );
    if (Number.isNaN(time)) return null;
    return {
        positionSeconds: time,
        durationSeconds: Number.isNaN(duration) ? null : duration,
    };
}

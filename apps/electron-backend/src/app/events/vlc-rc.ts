import { createConnection } from 'net';
import { buildHttpHeaderFields } from './external-player-playback-request';
import { ExternalPlaybackSnapshot } from './external-player-runtime';

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
    if (options.startTime && Number.isFinite(options.startTime)) {
        commands.push(`seek ${Math.floor(options.startTime)}`);
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
            if (shouldDispatch && !shouldDispatch()) {
                finish(undefined, false);
                return;
            }
            try {
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
    shouldDispatch?: () => boolean
): Promise<void> {
    for (const [index, command] of commands.entries()) {
        if (shouldDispatch && !shouldDispatch()) return;
        const dispatched = await sendVlcRcCommand(
            port,
            command,
            () => onCommandSent?.(command, index),
            shouldDispatch
        );
        if (!dispatched) return;
    }
}

export function parseVlcRcNumericResponse(data: string): string {
    return data.match(/>\s*(-?\d+(?:\.\d+)?)/)?.[1] ?? '';
}

export function parseVlcRcPlaybackState(data: string): string | null {
    return (
        data
            .match(/\(\s*state\s+([^)]+)\s*\)/i)?.[1]
            ?.trim()
            .toLowerCase() ?? null
    );
}

function getVlcCommandResponse(port: number, command: string): Promise<string> {
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
            if (data.includes('>')) finish(data);
        });
        client.on('error', () => finish(''));
    });
}

export async function getVlcPlaybackState(
    port: number
): Promise<string | null> {
    return parseVlcRcPlaybackState(await getVlcCommandResponse(port, 'status'));
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

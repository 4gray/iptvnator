import {
    mkdtempSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersistedRecordingItem } from '@iptvnator/shared/interfaces';

export interface PreparedVlcRecordingCommand {
    args: string[];
    inputFilePath: string;
    cleanup(): void;
}

const VLC_INPUT_PREFIX = 'iptvnator-vlc-';
const STALE_INPUT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export function cleanupStaleVlcRecordingInputs(
    nowMs = Date.now(),
    maxAgeMs = STALE_INPUT_MAX_AGE_MS,
    rootDirectory = tmpdir()
): void {
    let entries: Dirent[];
    try {
        entries = readdirSync(rootDirectory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(VLC_INPUT_PREFIX)) {
            continue;
        }
        const directory = join(rootDirectory, entry.name);
        try {
            if (nowMs - statSync(directory).mtimeMs < maxAgeMs) {
                continue;
            }
            const ownerPid = /^iptvnator-vlc-(\d+)-/.exec(entry.name)?.[1];
            if (ownerPid && isProcessAlive(Number(ownerPid))) {
                continue;
            }
            rmSync(directory, { recursive: true, force: true });
        } catch {
            // Cleanup is best-effort and must never block recording startup.
        }
    }
}

export function prepareVlcRecordingCommand(
    recording: PersistedRecordingItem,
    filePath: string
): PreparedVlcRecordingCommand {
    if (!recording.streamUrl) {
        throw new Error('Recording playback URL is no longer available');
    }
    if (/[\r\n\0]/.test(recording.streamUrl)) {
        throw new Error('Invalid recording playback URL');
    }

    const { userAgent, referer } = resolveVlcHttpHeaders(
        recording.requestHeaders ?? {}
    );
    const inputDirectory = mkdtempSync(
        join(tmpdir(), `${VLC_INPUT_PREFIX}${process.pid}-`)
    );
    const inputFilePath = join(inputDirectory, 'recording.m3u');
    const playlist = [
        '#EXTM3U',
        ...(userAgent ? [`#EXTVLCOPT:http-user-agent=${userAgent}`] : []),
        ...(referer ? [`#EXTVLCOPT:http-referrer=${referer}`] : []),
        recording.streamUrl,
        '',
    ].join('\n');

    try {
        writeFileSync(inputFilePath, playlist, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
    } catch (error) {
        rmSync(inputDirectory, { recursive: true, force: true });
        throw error;
    }

    return {
        args: buildVlcRecordingArgs(filePath, inputFilePath),
        inputFilePath,
        cleanup: () => rmSync(inputDirectory, { recursive: true, force: true }),
    };
}

export function validateVlcRecordingHeaders(
    headers: Record<string, string>
): void {
    resolveVlcHttpHeaders(headers);
}

export function buildVlcRecordingArgs(
    filePath: string,
    inputFilePath: string
): string[] {
    return [
        '--ignore-config',
        '--intf=dummy',
        '--extraintf=rc',
        '--rc-fake-tty',
        '--no-media-library',
        '--no-metadata-network-access',
        '--no-video',
        '--no-audio',
        '--no-osd',
        '--no-stats',
        '--no-sout-display',
        '--play-and-exit',
        '--sout-file-overwrite',
        '--sout=#standard',
        '--sout-standard-access=file',
        '--sout-standard-mux=ts',
        `--sout-standard-dst=${filePath}`,
        inputFilePath,
    ];
}

function resolveVlcHttpHeaders(headers: Record<string, string>): {
    userAgent?: string;
    referer?: string;
} {
    const unsupportedHeaders = Object.keys(headers).filter(
        (name) =>
            !['user-agent', 'referer', 'referrer'].includes(name.toLowerCase())
    );
    if (unsupportedHeaders.length > 0) {
        throw new Error(
            `VLC recording cannot forward required HTTP headers: ${unsupportedHeaders.join(
                ', '
            )}. Install the embedded MPV runtime for this stream.`
        );
    }

    let userAgent: string | undefined;
    let referer: string | undefined;
    for (const [rawName, rawValue] of Object.entries(headers)) {
        const name = rawName.trim();
        const value = String(rawValue).trim();
        if (!isSafeHttpHeader(name, value)) {
            throw new Error(`Invalid HTTP header for VLC recording: ${name}`);
        }
        if (name.toLowerCase() === 'user-agent') {
            userAgent = value;
        } else {
            referer = value;
        }
    }

    return { userAgent, referer };
}

function isSafeHttpHeader(name: string, value: string): boolean {
    return (
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) &&
        value.length > 0 &&
        !/[\r\n\0]/.test(value)
    );
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

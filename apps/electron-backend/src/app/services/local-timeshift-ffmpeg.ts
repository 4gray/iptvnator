import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join, win32 } from 'node:path';

export const LOCAL_TIMESHIFT_SEGMENT_SECONDS = 4;
// Shorter initial segments let the playlist become playable (and players
// buffer enough media) much sooner after a start or channel change; segment
// duration converges to LOCAL_TIMESHIFT_SEGMENT_SECONDS afterwards.
export const LOCAL_TIMESHIFT_INIT_SEGMENT_SECONDS = 1;
// FFmpeg's defaults (5 MB probesize, 5 s analyzeduration) delay the first
// output segment by several seconds on live TS/HLS input. Stream copy only
// needs the PMT-declared A/V streams, which are identified well within these
// bounds.
const INPUT_PROBE_SIZE_BYTES = 2_500_000;
const INPUT_ANALYZE_DURATION_MICROSECONDS = 2_000_000;
const FFMPEG_PROBE_TIMEOUT_MS = 2_000;
const HTTP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

type ProbeFfmpeg = (
    command: string,
    args: string[],
    options: {
        shell: false;
        stdio: 'ignore';
        timeout: number;
        windowsHide: true;
    }
) => SpawnSyncReturns<Buffer>;

export interface ResolveFfmpegOptions {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    probe?: ProbeFfmpeg;
}

export interface BuildLocalTimeshiftFfmpegArgsOptions {
    sourceUrl: string;
    requestHeaders?: Record<string, string>;
    maxDurationMinutes: number;
    outputDirectory: string;
}

export function resolveFfmpegCommand(
    options: ResolveFfmpegOptions = {}
): string | undefined {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const probe = options.probe ?? spawnSync;

    for (const command of ffmpegCandidates(platform, env)) {
        try {
            const result = probe(command, ['-version'], {
                shell: false,
                stdio: 'ignore',
                timeout: FFMPEG_PROBE_TIMEOUT_MS,
                windowsHide: true,
            });
            if (!result.error && result.status === 0) {
                return command;
            }
        } catch {
            // Try the next known location.
        }
    }
    return undefined;
}

export function ffmpegCandidates(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv
): string[] {
    const candidates = [env['FFMPEG_PATH']?.trim()].filter(
        (value): value is string => Boolean(value)
    );

    if (platform === 'win32') {
        candidates.push('ffmpeg.exe');
        if (env['ProgramFiles']) {
            candidates.push(
                win32.join(env['ProgramFiles'], 'ffmpeg', 'bin', 'ffmpeg.exe')
            );
        }
        if (env['LOCALAPPDATA']) {
            candidates.push(
                win32.join(
                    env['LOCALAPPDATA'],
                    'Microsoft',
                    'WinGet',
                    'Links',
                    'ffmpeg.exe'
                )
            );
        }
        if (env['ChocolateyInstall']) {
            candidates.push(
                win32.join(env['ChocolateyInstall'], 'bin', 'ffmpeg.exe')
            );
        }
    } else {
        candidates.push('ffmpeg');
        if (platform === 'darwin') {
            candidates.push(
                '/opt/homebrew/bin/ffmpeg',
                '/usr/local/bin/ffmpeg',
                '/usr/bin/ffmpeg'
            );
        } else {
            candidates.push(
                '/usr/bin/ffmpeg',
                '/usr/local/bin/ffmpeg',
                '/snap/bin/ffmpeg',
                '/app/bin/ffmpeg'
            );
        }
    }
    return [...new Set(candidates)];
}

export function buildLocalTimeshiftFfmpegArgs(
    options: BuildLocalTimeshiftFfmpegArgsOptions
): string[] {
    const listSize = localTimeshiftListSize(options.maxDurationMinutes);
    const headers = serializeFfmpegHeaders(options.requestHeaders ?? {});
    const inputArgs = headers ? ['-headers', headers] : [];

    return [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-nostdin',
        '-y',
        '-probesize',
        String(INPUT_PROBE_SIZE_BYTES),
        '-analyzeduration',
        String(INPUT_ANALYZE_DURATION_MICROSECONDS),
        ...inputArgs,
        '-i',
        assertSafeSourceUrl(options.sourceUrl),
        '-map',
        '0:v:0?',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-f',
        'hls',
        '-hls_time',
        String(LOCAL_TIMESHIFT_SEGMENT_SECONDS),
        '-hls_init_time',
        String(LOCAL_TIMESHIFT_INIT_SEGMENT_SECONDS),
        '-hls_list_size',
        String(listSize),
        '-hls_delete_threshold',
        '1',
        '-hls_allow_cache',
        '0',
        '-hls_flags',
        'delete_segments+temp_file+omit_endlist+independent_segments',
        '-hls_segment_filename',
        join(options.outputDirectory, 'segment-%09d.ts'),
        join(options.outputDirectory, 'index.m3u8'),
    ];
}

export function localTimeshiftListSize(maxDurationMinutes: number): number {
    if (
        !Number.isFinite(maxDurationMinutes) ||
        maxDurationMinutes <= 0 ||
        maxDurationMinutes > 24 * 60
    ) {
        throw new Error('Invalid local timeshift duration');
    }
    return Math.max(
        1,
        Math.ceil((maxDurationMinutes * 60) / LOCAL_TIMESHIFT_SEGMENT_SECONDS)
    );
}

export function serializeFfmpegHeaders(
    headers: Record<string, string>
): string | undefined {
    const lines = Object.entries(headers).map(([rawName, rawValue]) => {
        const name = rawName.trim();
        const value = String(rawValue).trim();
        if (
            !HTTP_HEADER_NAME.test(name) ||
            !value ||
            /[\r\n\0]/.test(rawName) ||
            /[\r\n\0]/.test(rawValue)
        ) {
            throw new Error(`Invalid local timeshift HTTP header: ${name}`);
        }
        return `${name}: ${value}`;
    });
    return lines.length ? `${lines.join('\r\n')}\r\n` : undefined;
}

function assertSafeSourceUrl(sourceUrl: string): string {
    const normalized = sourceUrl.trim();
    if (!normalized || /[\r\n\0]/.test(sourceUrl)) {
        throw new Error('Invalid local timeshift source URL');
    }
    return normalized;
}

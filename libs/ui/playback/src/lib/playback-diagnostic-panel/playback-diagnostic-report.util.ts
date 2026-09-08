import {
    collectPlaybackCodecs,
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    PlaybackDrmSystem,
    PlaybackRuntimeSupport,
    SHAKA_ERROR_CODE,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import { getDiagnosticEvidence } from './playback-diagnostic-summary.util';

function allowed<T extends string>(
    value: unknown,
    choices: readonly T[]
): T | undefined {
    return choices.find((choice) => choice === value);
}
function integer(value: unknown, min: number, max: number): number | undefined {
    return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max
        ? value
        : undefined;
}
function operatingSystem(agent: string): string {
    if (/Android/i.test(agent)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(agent)) return 'iOS';
    if (/Windows/i.test(agent)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(agent)) return 'macOS';
    if (/CrOS/i.test(agent)) return 'ChromeOS';
    if (/Linux/i.test(agent)) return 'Linux';
    return 'unknown';
}

/** Explicit allowlist: never serialize the diagnostic, source, or raw error. */
export function createDiagnosticReport(
    issue: PlaybackDiagnostic,
    appVersion: string,
    userAgent: string
): string {
    const evidence = getDiagnosticEvidence(issue);
    const codecs = collectPlaybackCodecs([
        ...issue.videoCodecs.slice(0, 16).map((videoCodec) => ({ videoCodec })),
        ...issue.audioCodecs.slice(0, 16).map((audioCodec) => ({ audioCodec })),
    ]);
    const shakaCode =
        issue.source === 'shaka' ? issue.shaka?.engineCode : undefined;
    return JSON.stringify(
        {
            schemaVersion: 1,
            app: 'IPTVnator',
            appVersion:
                /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:alpha|beta|rc)\.?\d{1,5})?$/.test(
                    appVersion
                )
                    ? appVersion
                    : 'unknown',
            os: operatingSystem(userAgent),
            runtime: /Electron\//i.test(userAgent) ? 'electron' : 'browser',
            code: allowed(issue.code, Object.values(PlaybackDiagnosticCode)),
            engine: allowed(
                issue.source,
                Object.values(PlaybackDiagnosticSource)
            ),
            player: allowed(issue.player, Object.values(InlinePlaybackPlayer)),
            runtimeSupport: allowed(
                issue.runtimeSupport,
                Object.values(PlaybackRuntimeSupport)
            ),
            stage: allowed(evidence?.stage, [
                'manifest',
                'playlist',
                'level',
                'segment',
                'key',
                'license',
                'media',
                'loader',
                'demux',
                'media-source',
            ]),
            engineCode: Object.values(SHAKA_ERROR_CODE).find(
                (code) => code === shakaCode
            ),
            nativeErrorCode: integer(issue.nativeErrorCode, 0, 99999),
            httpStatus: integer(
                evidence?.httpStatus ?? issue.httpStatus,
                100,
                599
            ),
            container: allowed(issue.container, [
                'mpd',
                'dash',
                'hls',
                'm3u8',
                'mp4',
                'webm',
                'matroska',
                'mpegts',
                'mpeg-ts',
                'ts',
                'avi',
                'mov',
                'flv',
                'ogg',
                'mp3',
                'aac',
            ]),
            ...codecs,
            drmSystems: Object.values(PlaybackDrmSystem).filter((system) =>
                issue.drmSystems?.includes(system)
            ),
        },
        null,
        2
    );
}

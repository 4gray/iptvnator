import type { ErrorData, ManifestParsedData } from 'hls.js';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    type PlaybackSourceMetadata,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyUnsupportedHlsManifestCodecs,
    createPlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.util';

/**
 * HTML5-player diagnostics glue extracted from the component: builds source
 * metadata and turns engine error payloads into emitted playback issues.
 */

export function createHtml5SourceMetadata(
    url: string,
    mimeType?: string,
    audioCodecs: readonly string[] = [],
    videoCodecs: readonly string[] = []
): PlaybackSourceMetadata {
    return createPlaybackSourceMetadata({
        url,
        mimeType,
        player: InlinePlaybackPlayer.Html5,
        audioCodecs,
        videoCodecs,
    });
}

export function emitUnsupportedHlsManifestCodecs(
    url: string,
    data: ManifestParsedData,
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void
): void {
    const metadata = createHtml5SourceMetadata(
        url,
        'application/x-mpegURL',
        data.levels
            .map((level) => level.audioCodec)
            .filter((codec): codec is string => Boolean(codec)),
        data.levels
            .map((level) => level.videoCodec)
            .filter((codec): codec is string => Boolean(codec))
    );
    const issue = classifyUnsupportedHlsManifestCodecs(metadata);
    if (issue) {
        emitPlaybackIssue(issue);
    }
}

export function emitFatalHlsPlaybackError(
    url: string,
    data: ErrorData,
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void
): void {
    if (!data.fatal) {
        return;
    }

    emitPlaybackIssue(
        classifyHlsPlaybackIssue(
            {
                type: data.type,
                details: data.details,
                fatal: data.fatal,
                message: data.error?.message,
                error: data.error,
            },
            createHtml5SourceMetadata(url, 'application/x-mpegURL')
        )
    );
}

export function emitMpegTsPlaybackError(
    url: string,
    error: { type: string; details: string; info: unknown },
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void
): void {
    emitPlaybackIssue(
        classifyMpegTsPlaybackIssue(
            error,
            createHtml5SourceMetadata(url, 'video/mp2t')
        )
    );
}

import {
    InlinePlaybackPlayer,
    classifyNativePlaybackIssue,
    classifyVhsPlaybackIssue,
    createPlaybackSourceMetadata,
} from '@iptvnator/playback/util';
import {
    getVideoJsPlaybackCodecs,
    hasActiveVhsSourceHandler,
    type VideoJsPlayer,
    type VideoPlayerSource,
} from './vjs-player.types';

export function createVideoJsPlaybackDiagnostic(
    player: VideoJsPlayer,
    source: VideoPlayerSource | null | undefined,
    video: HTMLVideoElement
) {
    const error = typeof player.error === 'function' ? player.error() : null;
    const metadata = createPlaybackSourceMetadata({
        ...getVideoJsPlaybackCodecs(player),
        url: source?.src ?? video.currentSrc ?? '',
        mimeType: source?.type,
        player: InlinePlaybackPlayer.VideoJs,
    });
    return error && hasActiveVhsSourceHandler(player)
        ? classifyVhsPlaybackIssue(error, metadata)
        : classifyNativePlaybackIssue(error ?? video.error, metadata);
}

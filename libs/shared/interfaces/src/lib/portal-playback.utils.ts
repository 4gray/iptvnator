import { ResolvedPortalPlayback } from './portal-playback.interface';

export function hasPlaybackHeaders(playback: ResolvedPortalPlayback): boolean {
    return Boolean(
        playback.requiresRequestHeaders ||
        playback.userAgent ||
        playback.referer ||
        playback.origin ||
        Object.keys(playback.headers ?? {}).length > 0
    );
}

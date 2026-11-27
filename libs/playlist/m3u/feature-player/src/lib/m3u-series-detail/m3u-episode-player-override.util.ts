import { Channel, VideoPlayer } from '@iptvnator/shared/interfaces';
import { extractDrmFromRaw, isDashChannel } from '@iptvnator/shared/m3u-utils';

/**
 * Whether an episode must play inline whatever the player setting: DASH and
 * any row with DRM — stated, or kept in the raw block by older imports. MPV
 * and VLC cannot carry KODIPROP keys.
 */
export function m3uEpisodeStaysInline(channel: Channel): boolean {
    return (
        isDashChannel(channel) ||
        !!(channel.drm ?? extractDrmFromRaw(channel.raw))
    );
}

/**
 * The inline engine for an episode that cannot leave the app.
 *
 * The configured engine may not play such a row: MPV and VLC have no inline
 * engine at all, and Video.js has no Shaka path. It gets the engine the
 * channel player uses for DASH — ArtPlayer when that is the setting, the
 * HTML5 player otherwise. Null keeps the setting.
 */
export function m3uEpisodePlayerOverride(
    channel: Channel | null | undefined,
    configured: VideoPlayer | null | undefined
): VideoPlayer | null {
    if (!channel || !m3uEpisodeStaysInline(channel)) {
        return null;
    }
    return configured === VideoPlayer.ArtPlayer
        ? VideoPlayer.ArtPlayer
        : VideoPlayer.Html5Player;
}

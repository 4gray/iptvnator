import { Channel } from '@iptvnator/shared/interfaces';
import { getPlaybackMediaExtensionFromUrl } from './playback-media-extension.util';

/**
 * DASH (`.mpd`) detection for M3U channels. DASH streams must always play in
 * a Shaka-capable built-in web engine: external MPV/VLC cannot receive the
 * KODIPROP ClearKey configuration, and Video.js has no DASH bridge yet.
 *
 * Uses the same normalized extension detection as the player engines, so
 * routing and engine selection always agree (`stream.MPD`, `?format=mpd`,
 * `?ext=mpd` and friends included).
 */
export const isDashStreamUrl = (url: string | undefined): boolean =>
    !!url && getPlaybackMediaExtensionFromUrl(url) === 'mpd';

export const isDashChannel = (
    channel: Pick<Channel, 'url'> | null | undefined
): boolean => isDashStreamUrl(channel?.url);

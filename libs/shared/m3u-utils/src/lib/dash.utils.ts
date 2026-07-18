import { Channel } from '@iptvnator/shared/interfaces';
import { getStreamExtensionFromUrl } from './playlist.utils';

/**
 * DASH (`.mpd`) detection for M3U channels. DASH streams must always play in
 * a Shaka-capable built-in web engine: external MPV/VLC cannot receive the
 * KODIPROP ClearKey configuration, and Video.js has no DASH bridge yet.
 */
export const isDashStreamUrl = (url: string | undefined): boolean =>
    !!url && getStreamExtensionFromUrl(url) === 'mpd';

export const isDashChannel = (
    channel: Pick<Channel, 'url'> | null | undefined
): boolean => isDashStreamUrl(channel?.url);

import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/shared/m3u-utils';
import { PlaybackSourceKind } from './playback-recommendation.model';

/**
 * Engine family a playback URL is routed to BEFORE any engine runs.
 *
 * `resolvePlaybackSourceKind()` answers the opposite question — which family
 * a diagnostic came out of after an engine failed. Every built-in web player
 * selects its source engine through this function, so the HTML5 player and
 * ArtPlayer cannot disagree on what a URL is. A URL never yields `unknown`:
 * an unrecognized container is exactly what the native `<video>` element is
 * for.
 */
export type PlaybackUrlSourceKind = Exclude<
    PlaybackSourceKind,
    typeof PlaybackSourceKind.Unknown
>;

const DASH_MANIFEST_EXTENSION = 'mpd';
const HLS_MANIFEST_EXTENSIONS: ReadonlySet<string> = new Set(['m3u', 'm3u8']);
/**
 * `.m2ts` (BDAV, 192-byte packets) rides with `.ts`: mpegts.js probes the
 * packet size itself, so its `mpegts` player type covers both.
 */
const MPEG_TS_EXTENSIONS: ReadonlySet<string> = new Set(['ts', 'm2ts']);

export function resolvePlaybackUrlSourceKind(
    url: string
): PlaybackUrlSourceKind {
    const extension = getPlaybackMediaExtensionFromUrl(url);
    if (extension === DASH_MANIFEST_EXTENSION) {
        return PlaybackSourceKind.Dash;
    }
    if (HLS_MANIFEST_EXTENSIONS.has(extension)) {
        return PlaybackSourceKind.Hls;
    }
    // Extension-less IPTV proxy/script URLs (`/live/user/pass/1`, `.php`)
    // are predominantly raw MPEG-TS and keep the established engine.
    if (!extension || MPEG_TS_EXTENSIONS.has(extension)) {
        return PlaybackSourceKind.MpegTs;
    }
    // Every other container — mkv, webm, mp4, avi, mov, m4v, audio files —
    // is handed to the browser. hls.js only ever receives HLS manifests: fed
    // an .mkv it raised a manifest error over media Chromium plays natively.
    return PlaybackSourceKind.Native;
}

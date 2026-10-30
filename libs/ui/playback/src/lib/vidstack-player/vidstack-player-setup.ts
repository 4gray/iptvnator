import type {
    HLSSrc,
    MediaStorage,
    MediaStreamType,
    VideoSrc,
} from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';
import {
    InlinePlaybackPlayer,
    PlaybackSourceKind,
    createPlaybackSourceMetadata,
    resolvePlaybackUrlSourceKind,
} from '@iptvnator/playback/util';
import type { PlayerMediaTitle } from '../player-controls';

/** Engine that serves a channel URL inside the Vidstack player. */
export type VidstackSourceKind = 'hls' | 'mpegts' | 'dash' | 'native';

export interface VidstackSource {
    readonly kind: VidstackSourceKind;
    readonly url: string;
    /**
     * The `src` handed to `<media-player>`. Sources served by the app's own
     * engines (mpegts.js, Shaka, the bare `<video>`) carry a type Vidstack's
     * video provider always claims: they only need Vidstack to create that
     * provider, and `VidstackSourceSession` owns its `loadSource`.
     */
    readonly src: HLSSrc | VideoSrc;
}

/**
 * Maps the shared URL routing decision onto a Vidstack source, so Vidstack,
 * ArtPlayer and the HTML5 player always pick the same engine for a URL.
 *
 * Every source carries an explicit type: an untyped one makes Vidstack send a
 * `HEAD` request to sniff its `content-type`, an extra cross-origin request
 * many IPTV servers reject.
 */
export function resolveVidstackSource(url: string): VidstackSource {
    const kind = toVidstackSourceKind(resolvePlaybackUrlSourceKind(url));
    return {
        kind,
        url,
        src:
            kind === 'hls'
                ? { src: url, type: 'application/x-mpegurl' }
                : { src: url, type: 'video/mp4' },
    };
}

function toVidstackSourceKind(kind: PlaybackSourceKind): VidstackSourceKind {
    switch (kind) {
        case PlaybackSourceKind.Hls:
            return 'hls';
        case PlaybackSourceKind.MpegTs:
            return 'mpegts';
        case PlaybackSourceKind.Dash:
            return 'dash';
        default:
            return 'native';
    }
}

export interface VidstackPlayerElementOptions {
    readonly source: VidstackSource;
    readonly isLive: boolean;
    readonly title: string;
    readonly storage: MediaStorage;
    /**
     * Preference-off mode renders Vidstack's own default video layout. Its
     * menus mount into this element instead of `document.body`, so they stay
     * inside the component's style scope.
     */
    readonly defaultLayoutMenuContainer: HTMLElement | null;
}

export interface VidstackStorageOptions {
    readonly getVolume: () => number;
    readonly getStartTime: () => number;
    readonly showCaptions: () => boolean;
}

/**
 * Read-only Vidstack storage backed by the app's own state: the app volume,
 * the resume position and the "Show subtitles" preference. Vidstack reads it
 * when the media can first play (volume, mute, resume) and when it picks the
 * default caption track, so the preference seeds each source and the layout's
 * caption menu keeps working afterwards. It never writes: the app persists
 * volume and playback history itself.
 */
export function createVidstackStorage(
    options: VidstackStorageOptions
): MediaStorage {
    const none = async (): Promise<null> => null;
    return {
        getVolume: async () => options.getVolume(),
        getMuted: async () => options.getVolume() <= 0,
        getTime: async () => {
            const startTime = options.getStartTime();
            return startTime > 0 ? startTime : null;
        },
        getLang: none,
        getCaptions: async () => options.showCaptions(),
        getPlaybackRate: none,
        getVideoQuality: none,
        getAudioGain: none,
    };
}

/**
 * Builds `<media-player>` with its provider and, in preference-off mode, the
 * default video layout. Requires the elements registered by
 * `vidstack-elements.ts`.
 */
export function createVidstackPlayerElement(
    options: VidstackPlayerElementOptions
): MediaPlayerElement {
    const player = document.createElement('media-player') as MediaPlayerElement;
    player.classList.add('vidstack-player');
    player.src = options.source.src;
    player.title = options.title;
    player.storage = options.storage;
    player.streamType = resolveVidstackStreamType(
        options.source,
        options.isLive
    );
    player.autoPlay = true;
    player.playsInline = true;
    // Vidstack defers loading until the player scrolls into view by default.
    player.load = 'eager';
    // App-level shortcuts own the keyboard in both control modes: Vidstack's
    // focus-scoped shortcuts would double-handle every key they cover.
    player.keyDisabled = true;

    player.append(document.createElement('media-provider'));
    if (options.defaultLayoutMenuContainer) {
        const layout = document.createElement('media-video-layout');
        layout.menuContainer = options.defaultLayoutMenuContainer;
        // Every IPTVnator player chrome is dark, whatever the app theme.
        layout.colorScheme = 'dark';
        player.append(layout);
    }
    return player;
}

/**
 * HLS stream type is left to Vidstack, which reads it from the playlist: an
 * M3U entry marked live can still carry a VOD playlist, and a provided `live`
 * type makes Vidstack jump to its end. Every other engine plays through the
 * video provider, which would infer `on-demand` even for a live MPEG-TS
 * stream, so those take the app's live/VOD answer.
 */
export function resolveVidstackStreamType(
    source: VidstackSource,
    isLive: boolean
): MediaStreamType {
    if (source.kind === 'hls') {
        return 'unknown';
    }
    return isLive ? 'live' : 'on-demand';
}

/** Title shown by Vidstack's layout and announced for the player region. */
export function formatVidstackTitle(
    mediaTitle: PlayerMediaTitle | null,
    fallback: string
): string {
    const primary = mediaTitle?.primary?.trim();
    if (!primary) {
        return fallback;
    }
    const secondary = mediaTitle?.secondary?.trim();
    return secondary ? `${primary} · ${secondary}` : primary;
}

export function createVidstackSourceMetadata(
    url: string,
    mimeType?: string,
    audioCodecs: readonly string[] = [],
    videoCodecs: readonly string[] = []
) {
    return createPlaybackSourceMetadata({
        url,
        mimeType,
        player: InlinePlaybackPlayer.Vidstack,
        audioCodecs,
        videoCodecs,
    });
}

export function exitOwnedVidstackFullscreen(
    sharedControls: boolean,
    surface: HTMLElement | undefined,
    reportError: (error: unknown) => void
): void {
    if (
        !sharedControls ||
        document.fullscreenElement !== surface ||
        typeof document.exitFullscreen !== 'function'
    ) {
        return;
    }

    try {
        void Promise.resolve(document.exitFullscreen()).catch(reportError);
    } catch (error: unknown) {
        reportError(error);
    }
}

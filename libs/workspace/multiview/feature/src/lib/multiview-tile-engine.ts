import Hls, { type ErrorData } from 'hls.js';
import mpegts from 'mpegts.js';
import {
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    createPlaybackSourceMetadata,
    getPlaybackMediaExtensionFromUrl,
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
} from '@iptvnator/ui/playback';

function clearNativeVideoSources(element: HTMLVideoElement): void {
    element.removeAttribute('src');
    element.replaceChildren();
}

function replaceNativeVideoSource(
    element: HTMLVideoElement,
    url: string,
    type: string
): void {
    clearNativeVideoSources(element);
    const source = document.createElement('source');
    source.src = url;
    source.type = type;
    element.appendChild(source);
    element.load();
}

export interface MultiviewTileEngineConfig {
    readonly video: HTMLVideoElement;
    readonly url: string;
    readonly onError: (diagnostic: PlaybackDiagnostic) => void;
    readonly onPlaying?: () => void;
}

/**
 * Minimal per-tile media engine for the multiview grid. Mirrors the engine
 * selection of the HTML5 player (mpegts.js for raw TS, hls.js for HLS,
 * native <source> fallback) without controls, captions, or shared volume
 * persistence — tiles start muted and audio focus is handled by the tile
 * component.
 */
export class MultiviewTileEngine {
    private hls: Hls | null = null;
    private mpegtsPlayer: mpegts.Player | null = null;
    private started = false;
    private destroyed = false;

    constructor(private readonly config: MultiviewTileEngineConfig) {}

    start(): void {
        if (this.started || this.destroyed) {
            return;
        }
        this.started = true;

        const { video, url } = this.config;
        const extension = getPlaybackMediaExtensionFromUrl(url);
        video.muted = true;

        if ((extension === 'ts' || !extension) && mpegts.isSupported()) {
            this.startMpegts(video, url);
        } else if (
            extension !== 'mp4' &&
            extension !== 'mpv' &&
            Hls &&
            Hls.isSupported()
        ) {
            this.startHls(video, url);
        } else {
            replaceNativeVideoSource(video, url, 'video/mp4');
            this.playSafely(video);
        }
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;

        const mpegtsPlayer = this.mpegtsPlayer;
        this.mpegtsPlayer = null;
        if (mpegtsPlayer) {
            mpegtsPlayer.pause();
            mpegtsPlayer.unload();
            mpegtsPlayer.detachMediaElement();
            mpegtsPlayer.destroy();
        }

        const hls = this.hls;
        this.hls = null;
        hls?.destroy();

        this.config.video.pause();
        clearNativeVideoSources(this.config.video);
    }

    private startMpegts(video: HTMLVideoElement, url: string): void {
        const player = mpegts.createPlayer(
            {
                type: 'mpegts',
                isLive: true,
                url,
            },
            {
                // Keep per-tile latency/memory bounded; several tiles run
                // concurrently.
                liveBufferLatencyChasing: true,
            }
        );
        this.mpegtsPlayer = player;
        player.attachMediaElement(video);
        player.on(
            mpegts.Events.ERROR,
            (type: string, details: string, info: unknown): void => {
                this.emitError(
                    classifyMpegTsPlaybackIssue(
                        { type, details, info },
                        this.createMetadata(url, 'video/mp2t')
                    )
                );
            }
        );
        player.load();
        this.playSafely(video);
    }

    private startHls(video: HTMLVideoElement, url: string): void {
        const hls = new Hls({
            // Small buffers: up to nine tiles can stream concurrently.
            maxBufferLength: 10,
            backBufferLength: 0,
        });
        this.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            this.playSafely(video);
        });
        hls.on(Hls.Events.ERROR, (_, data: ErrorData) => {
            if (!data.fatal) {
                return;
            }
            this.emitError(
                classifyHlsPlaybackIssue(
                    {
                        type: data.type,
                        details: data.details,
                        fatal: data.fatal,
                        message: data.error?.message,
                        error: data.error,
                    },
                    this.createMetadata(url, 'application/x-mpegURL')
                )
            );
        });
        hls.attachMedia(video);
        hls.loadSource(url);
    }

    private createMetadata(url: string, mimeType: string) {
        return createPlaybackSourceMetadata({
            url,
            mimeType,
            player: InlinePlaybackPlayer.Html5,
        });
    }

    private emitError(diagnostic: PlaybackDiagnostic): void {
        if (this.destroyed) {
            return;
        }
        this.config.onError(diagnostic);
    }

    private playSafely(video: HTMLVideoElement): void {
        const onPlaying = this.config.onPlaying;
        if (onPlaying) {
            video.addEventListener('playing', () => onPlaying(), {
                once: true,
            });
        }
        // Tiles are muted, so autoplay is allowed; swallow rejections anyway.
        const playPromise = video.play() as Promise<void> | undefined;
        playPromise?.catch(() => undefined);
    }
}

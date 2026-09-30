import type {
    HLSProvider,
    HTMLMediaSrc,
    MediaProviderAdapter,
    Src,
    VideoProvider,
} from 'vidstack';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyMpegTsPlaybackIssue,
    collectPlaybackCodecs,
    createMpegTsPlaybackEvidence,
} from '@iptvnator/playback/util';
import type { WebVideoControlsAdapter } from '../player-controls';
import type { ShakaModuleLoader } from '../shaka-engine/shaka-module.types';
import { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import {
    type WebVideoControlsSource,
    WebVideoSourceControlsBridge,
} from '../web-video-support/web-video-source-controls.bridge';
import { WebVideoSourceTracks } from '../web-video-support/web-video-source-tracks';
import { VidstackHlsObserver } from './vidstack-hls-observer';
import {
    type VidstackSource,
    createVidstackSourceMetadata,
} from './vidstack-player-setup';

export interface VidstackSourceSessionConfig {
    source: VidstackSource;
    sharedControls: boolean;
    controlsAdapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void;
    /** DRM config of the active channel, used by the DASH (Shaka) engine. */
    getDrm?: () => ChannelDrm | undefined;
    /** Test seam for the lazily imported shaka-player module. */
    loadShaka?: ShakaModuleLoader;
}

type VideoBackedProvider = VideoProvider | HLSProvider;

/**
 * Owns the source engines behind one Vidstack player and the shared-controls
 * track bridge.
 *
 * Vidstack announces each provider through `provider-change` before setting it
 * up. HLS stays on Vidstack's HLS provider, fed the bundled hls.js instead of
 * its jsDelivr default, so the default layout keeps its quality, audio and
 * caption menus; the session only observes that hls.js instance. MPEG-TS,
 * DASH and every other container run on the video provider's `<video>`, whose
 * `loadSource` the session replaces with mpegts.js, Shaka or a bare `src`.
 * Callbacks become no-ops after destroy.
 */
export class VidstackSourceSession {
    private video: HTMLVideoElement | null = null;
    private controlsBridge: WebVideoSourceControlsBridge | null = null;
    /**
     * Preference-off counterpart of {@link controlsBridge}: applies the
     * `showCaptions` preference to the engines Vidstack's text tracks do not
     * see (native tracks, Shaka).
     */
    private captionTracks: WebVideoSourceTracks | null = null;
    private readonly hlsObserver: VidstackHlsObserver;
    private disposeHlsInstance: (() => void) | null = null;
    private mpegTsPlayer: mpegts.Player | null = null;
    private mpegTsErrorListener:
        | ((type: unknown, details: unknown, info: unknown) => void)
        | null = null;
    private shakaSession: ShakaVideoSession | null = null;
    private destroyed = false;

    constructor(private readonly config: VidstackSourceSessionConfig) {
        this.hlsObserver = new VidstackHlsObserver({
            url: config.source.url,
            emitPlaybackIssue: (issue) => this.emitPlaybackIssue(issue),
        });
    }

    /**
     * Configures the provider announced by `provider-change` and returns the
     * `<video>` it renders into, or null for a provider without one.
     */
    attachProvider(
        provider: MediaProviderAdapter | null
    ): HTMLVideoElement | null {
        if (this.destroyed || !isVideoBackedProvider(provider)) {
            return null;
        }

        this.bindVideo(provider.video);
        if (provider.type === 'hls') {
            this.configureHlsProvider(provider as HLSProvider);
        } else if (this.config.source.kind === 'hls') {
            // Without MediaSource (iOS Safari) Vidstack's video provider plays
            // the manifest natively.
            this.bindControlsSource({ kind: 'native' });
        } else {
            this.takeOverLoadSource(provider);
        }
        return provider.video;
    }

    refreshInputs(): void {
        this.controlsBridge?.refreshInputs();
        this.captionTracks?.refreshInputs();
    }

    resolveDuration(fallbackDuration: number): number {
        const correctedDuration = this.controlsBridge?.readDuration() ?? NaN;
        return Number.isNaN(correctedDuration)
            ? fallbackDuration
            : correctedDuration;
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.hlsObserver.release();
        this.disposeHlsInstance?.();
        this.disposeHlsInstance = null;
        this.destroyMpegTs();
        this.shakaSession?.destroy();
        this.shakaSession = null;
        this.releaseVideo();
    }

    private bindVideo(video: HTMLVideoElement): void {
        if (this.video === video) {
            return;
        }

        this.releaseVideo();
        this.video = video;
        if (!this.config.sharedControls) {
            this.captionTracks = new WebVideoSourceTracks({
                video,
                showCaptions: this.config.showCaptions,
                vendorCaptionControls: true,
            });
            return;
        }

        const bridge = new WebVideoSourceControlsBridge({
            video,
            adapter: this.config.controlsAdapter,
            isLive: this.config.isLive,
            showCaptions: this.config.showCaptions,
        });
        this.controlsBridge = bridge;
        bridge.attach();
    }

    private releaseVideo(): void {
        this.controlsBridge?.destroy();
        this.controlsBridge = null;
        this.captionTracks?.destroy();
        this.captionTracks = null;
        this.video = null;
    }

    private configureHlsProvider(provider: HLSProvider): void {
        // Vidstack defaults to hls.js from jsDelivr, which the renderer CSP
        // (`script-src 'self'`) blocks and an offline desktop cannot reach.
        provider.library = Hls;
        if (this.config.sharedControls) {
            // The shared controls read hls.js subtitles as native text
            // tracks, exactly as they do for the other web players.
            provider.config = { renderTextTracksNatively: true };
        }
        this.disposeHlsInstance?.();
        this.disposeHlsInstance = provider.onInstance((hls) => {
            if (this.destroyed) {
                return;
            }
            this.hlsObserver.observe(hls);
            this.bindControlsSource({ kind: 'hls', hls });
        });
    }

    private takeOverLoadSource(provider: VideoProvider): void {
        const { source } = this.config;
        provider.loadSource = async (src, preload) => {
            if (this.destroyed) {
                return;
            }
            provider.video.preload = preload ?? '';
            this.startEngine(provider.video, source);
            // Vidstack compares `currentSrc` with the selected source to skip
            // reloading the source it already loaded.
            provider.currentSrc = src as Src<HTMLMediaSrc>;
        };
    }

    private startEngine(video: HTMLVideoElement, source: VidstackSource): void {
        this.controlsBridge?.clearSource();
        this.captionTracks?.clearSource();
        this.destroyMpegTs();
        this.shakaSession?.stop();

        if (source.kind === 'dash') {
            this.startDash(video, source.url);
            return;
        }
        if (source.kind === 'mpegts' && this.startMpegTs(video, source.url)) {
            return;
        }
        video.src = source.url;
        this.bindControlsSource({ kind: 'native' });
    }

    /** Returns false when MediaSource is missing and the browser must try. */
    private startMpegTs(video: HTMLVideoElement, url: string): boolean {
        if (!mpegts.isSupported()) {
            return false;
        }

        const engine = mpegts.createPlayer({
            type: 'mpegts',
            isLive: this.config.isLive(),
            url,
        });
        this.mpegTsPlayer = engine;
        this.mpegTsErrorListener = (type, details, info) => {
            if (this.destroyed || this.mpegTsPlayer !== engine) {
                return;
            }
            this.emitPlaybackIssue(
                classifyMpegTsPlaybackIssue(
                    createMpegTsPlaybackEvidence(type, details, info),
                    {
                        ...createVidstackSourceMetadata(url, 'video/mp2t'),
                        ...collectPlaybackCodecs([engine.mediaInfo ?? {}]),
                    }
                )
            );
        };

        engine.attachMediaElement(video);
        this.bindControlsSource({ kind: 'mpegts' });
        engine.on(mpegts.Events.ERROR, this.mpegTsErrorListener);
        // Playback starts through Vidstack's autoplay once the media can play.
        engine.load();
        return true;
    }

    private startDash(video: HTMLVideoElement, url: string): void {
        this.shakaSession ??= new ShakaVideoSession({
            player: InlinePlaybackPlayer.Vidstack,
            emitPlaybackIssue: (issue) => this.emitPlaybackIssue(issue),
            showCaptions: this.config.showCaptions,
            loadShaka: this.config.loadShaka,
        });
        this.bindControlsSource({ kind: 'shaka', session: this.shakaSession });
        this.shakaSession.start(video, url, this.config.getDrm?.());
    }

    private bindControlsSource(source: WebVideoControlsSource): void {
        this.controlsBridge?.setSource(source);
        // Preference off, Vidstack renders hls.js subtitles itself and seeds
        // them from its storage's caption preference.
        if (source.kind === 'hls') {
            this.captionTracks?.clearSource();
        } else {
            this.captionTracks?.setSource(source);
        }
    }

    private destroyMpegTs(): void {
        const engine = this.mpegTsPlayer;
        if (!engine) {
            this.mpegTsErrorListener = null;
            return;
        }

        if (this.mpegTsErrorListener) {
            engine.off(mpegts.Events.ERROR, this.mpegTsErrorListener);
        }
        this.mpegTsErrorListener = null;
        engine.pause();
        engine.unload();
        engine.detachMediaElement();
        engine.destroy();
        this.mpegTsPlayer = null;
    }

    private emitPlaybackIssue(issue: PlaybackDiagnostic): void {
        if (!this.destroyed) {
            this.config.emitPlaybackIssue(issue);
        }
    }
}

function isVideoBackedProvider(
    provider: MediaProviderAdapter | null
): provider is VideoBackedProvider {
    return (
        (provider?.type === 'video' || provider?.type === 'hls') &&
        'video' in provider &&
        provider.video instanceof HTMLVideoElement
    );
}

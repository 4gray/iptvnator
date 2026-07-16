import type Artplayer from 'artplayer';
import type { Option } from 'artplayer';
import Hls, { type ErrorData, type ManifestParsedData } from 'hls.js';
import mpegts from 'mpegts.js';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyUnsupportedHlsManifestCodecs,
    createPlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.util';
import type { WebVideoControlsAdapter } from '../player-controls';
import {
    type WebVideoControlsSource,
    WebVideoSourceControlsBridge,
} from '../web-video-support/web-video-source-controls.bridge';
import { addHlsAudioTrackSettings } from './art-player-audio-tracks';

export interface ArtPlayerSourceSessionConfig {
    sharedControls: boolean;
    controlsAdapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void;
}

/**
 * Owns ArtPlayer's custom source engines and the shared-controls track bridge.
 *
 * A session belongs to one ArtPlayer instance. Its customType callbacks use the
 * callback-local `art` argument and become no-ops after destroy, so ArtPlayer's
 * delayed URL dispatch cannot mutate a newer component player.
 */
export class ArtPlayerSourceSession {
    readonly customType: NonNullable<Option['customType']> = {
        m3u8: (video, url, art) => this.startHls(video, url, art),
        ts: (video, url) => this.startMpegTs(video, url),
        'video/matroska': (video, url) => this.startNative(video, url),
    };

    private player: Artplayer | null = null;
    private controlsBridge: WebVideoSourceControlsBridge | null = null;
    private pendingControlsSource: WebVideoControlsSource = { kind: 'native' };
    private hls: Hls | null = null;
    private hlsManifestListener:
        | ((event: unknown, data: ManifestParsedData) => void)
        | null = null;
    private hlsErrorListener:
        | ((event: unknown, data: ErrorData) => void)
        | null = null;
    private mpegTsPlayer: mpegts.Player | null = null;
    private mpegTsErrorListener:
        | ((type: string, details: string, info: unknown) => void)
        | null = null;
    private destroyed = false;

    constructor(private readonly config: ArtPlayerSourceSessionConfig) {}

    attach(player: Artplayer): void {
        if (this.destroyed || this.player) {
            return;
        }

        this.player = player;
        if (!this.config.sharedControls) {
            return;
        }

        const bridge = new WebVideoSourceControlsBridge({
            video: player.video,
            adapter: this.config.controlsAdapter,
            isLive: this.config.isLive,
            showCaptions: this.config.showCaptions,
        });
        this.controlsBridge = bridge;
        bridge.attach();
        bridge.setSource(this.pendingControlsSource);
    }

    refreshInputs(): void {
        this.controlsBridge?.refreshInputs();
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
        this.controlsBridge?.destroy();
        this.controlsBridge = null;
        this.destroyHls();
        this.destroyMpegTs();
        this.player = null;
    }

    private startHls(
        video: HTMLVideoElement,
        url: string,
        art: Artplayer
    ): void {
        if (this.destroyed) {
            return;
        }

        this.prepareForSourceChange();
        if (Hls.isSupported()) {
            const hls = new Hls();
            this.hls = hls;
            this.hlsManifestListener = (_event, data) => {
                if (this.destroyed || this.hls !== hls) {
                    return;
                }
                this.handleHlsManifestParsed(url, data);
            };
            this.hlsErrorListener = (_event, data) => {
                if (this.destroyed || this.hls !== hls) {
                    return;
                }
                this.handleHlsError(url, data);
            };
            hls.on(Hls.Events.MANIFEST_PARSED, this.hlsManifestListener);
            hls.on(Hls.Events.ERROR, this.hlsErrorListener);
            hls.attachMedia(video);
            this.bindControlsSource({ kind: 'hls', hls });
            hls.loadSource(url);
            if (!this.config.sharedControls) {
                addHlsAudioTrackSettings(art, hls);
            }
            return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            this.bindControlsSource({ kind: 'native' });
        }
    }

    private startMpegTs(video: HTMLVideoElement, url: string): void {
        if (this.destroyed) {
            return;
        }

        this.prepareForSourceChange();
        if (!mpegts.isSupported()) {
            return;
        }
        const engine = mpegts.createPlayer({
            type: 'mpegts',
            isLive: this.config.sharedControls ? this.config.isLive() : true,
            url,
        });
        this.mpegTsPlayer = engine;
        this.mpegTsErrorListener = (type, details, info) => {
            if (this.destroyed || this.mpegTsPlayer !== engine) {
                return;
            }
            this.config.emitPlaybackIssue(
                classifyMpegTsPlaybackIssue(
                    { type, details, info },
                    this.createSourceMetadata(url, 'video/mp2t')
                )
            );
        };

        engine.attachMediaElement(video);
        this.bindControlsSource({ kind: 'mpegts' });
        engine.on(mpegts.Events.ERROR, this.mpegTsErrorListener);
        engine.load();
        const playResult = engine.play();
        if (playResult) {
            void playResult.catch(() => undefined);
        }
    }

    private startNative(video: HTMLVideoElement, url: string): void {
        if (this.destroyed) {
            return;
        }

        this.prepareForSourceChange();
        video.src = url;
        this.bindControlsSource({ kind: 'native' });
    }

    private prepareForSourceChange(): void {
        this.controlsBridge?.clearSource();
        this.destroyHls();
        this.destroyMpegTs();
    }

    private bindControlsSource(source: WebVideoControlsSource): void {
        this.pendingControlsSource = source;
        this.controlsBridge?.setSource(source);
    }

    private destroyHls(): void {
        const hls = this.hls;
        if (!hls) {
            this.hlsManifestListener = null;
            this.hlsErrorListener = null;
            return;
        }

        if (this.hlsManifestListener) {
            hls.off(Hls.Events.MANIFEST_PARSED, this.hlsManifestListener);
        }
        if (this.hlsErrorListener) {
            hls.off(Hls.Events.ERROR, this.hlsErrorListener);
        }
        this.hlsManifestListener = null;
        this.hlsErrorListener = null;
        hls.destroy();
        this.hls = null;
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

    private handleHlsManifestParsed(
        url: string,
        data: ManifestParsedData
    ): void {
        const metadata = this.createSourceMetadata(
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
            this.config.emitPlaybackIssue(issue);
        }
    }

    private handleHlsError(url: string, data: ErrorData): void {
        if (!data.fatal) {
            return;
        }

        this.config.emitPlaybackIssue(
            classifyHlsPlaybackIssue(
                {
                    type: data.type,
                    details: data.details,
                    fatal: data.fatal,
                    message: data.error?.message,
                    error: data.error,
                },
                this.createSourceMetadata(url, 'application/x-mpegURL')
            )
        );
    }

    private createSourceMetadata(
        url: string,
        mimeType?: string,
        audioCodecs: readonly string[] = [],
        videoCodecs: readonly string[] = []
    ) {
        return createPlaybackSourceMetadata({
            url,
            mimeType,
            player: InlinePlaybackPlayer.ArtPlayer,
            audioCodecs,
            videoCodecs,
        });
    }
}

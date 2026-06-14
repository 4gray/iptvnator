import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
} from '@angular/core';
import Artplayer from 'artplayer';
import Hls, { type ErrorData, type ManifestParsedData } from 'hls.js';
import mpegts from 'mpegts.js';
import { Channel } from '@iptvnator/shared/interfaces';
import { addHlsAudioTrackSettings } from './art-player-audio-tracks';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
    classifyHlsPlaybackIssue,
    classifyMpegTsPlaybackIssue,
    classifyNativePlaybackIssue,
    classifyUnsupportedHlsManifestCodecs,
    createPlaybackSourceMetadata,
    getPlaybackMediaExtensionFromUrl,
} from '../playback-diagnostics/playback-diagnostics.util';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';

Artplayer.AUTO_PLAYBACK_TIMEOUT = 10000;

@Component({
    selector: 'app-art-player',
    imports: [SeriesPlaybackNavigationControlsComponent],
    templateUrl: './art-player.component.html',
    styleUrls: ['./art-player.component.scss'],
})
export class ArtPlayerComponent implements OnInit, OnDestroy, OnChanges {
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() showCaptions = false;
    @Input() startTime = 0;
    @Input() seriesNavigation: SeriesPlaybackNavigation | null = null;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    @Output() playbackIssue = new EventEmitter<PlaybackDiagnostic | null>();
    @Output() playbackEnded = new EventEmitter<void>();
    @Output() previousEpisodeRequested = new EventEmitter<void>();
    @Output() nextEpisodeRequested = new EventEmitter<void>();

    private player!: Artplayer;
    private hls: Hls | null = null;
    private mpegtsPlayer: mpegts.Player | null = null;

    private readonly elementRef = inject(ElementRef);

    private readonly handleNativePlaybackError = () => {
        this.playbackIssue.emit(
            classifyNativePlaybackIssue(
                this.player?.video?.error,
                this.createSourceMetadata(
                    this.channel?.url ?? this.player?.video?.currentSrc ?? ''
                )
            )
        );
    };

    private readonly clearPlaybackIssue = () => {
        this.playbackIssue.emit(null);
    };

    private readonly handlePlaybackEnded = () => {
        this.playbackEnded.emit();
    };

    ngOnInit(): void {
        this.initPlayer();
    }

    ngOnDestroy(): void {
        this.destroyPlayer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && !changes['channel'].firstChange) {
            this.destroyPlayer();
            this.initPlayer();
        }
        if (changes['volume'] && this.player) {
            this.applyVolume(changes['volume'].currentValue);
        }
    }

    private destroyPlayer(): void {
        if (this.mpegtsPlayer) {
            this.mpegtsPlayer.pause();
            this.mpegtsPlayer.unload();
            this.mpegtsPlayer.detachMediaElement();
            this.mpegtsPlayer.destroy();
            this.mpegtsPlayer = null;
        }
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.player) {
            this.player.video?.removeEventListener(
                'error',
                this.handleNativePlaybackError
            );
            this.player.video?.removeEventListener(
                'loadeddata',
                this.clearPlaybackIssue
            );
            this.player.video?.removeEventListener(
                'playing',
                this.clearPlaybackIssue
            );
            this.player.video?.removeEventListener(
                'ended',
                this.handlePlaybackEnded
            );
            this.player.destroy();
        }
    }

    private initPlayer(): void {
        this.playbackIssue.emit(null);
        const el = this.elementRef.nativeElement.querySelector(
            '.artplayer-container'
        );
        const extension = getPlaybackMediaExtensionFromUrl(
            this.channel?.url ?? ''
        );
        const isLive = extension === 'm3u8' || extension === 'ts' || !extension;

        this.player = new Artplayer({
            container: el,
            url: this.channel.url + (this.channel.epgParams || ''),
            volume: this.clampVolume(this.volume),
            isLive: isLive,
            autoplay: true,
            type: this.getVideoType(this.channel.url),
            pip: true,
            autoPlayback: true,
            autoSize: true,
            autoMini: true,
            screenshot: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            playsInline: true,
            airplay: true,
            backdrop: true,
            mutex: true,
            theme: '#ff0000',
            customType: {
                m3u8: (video: HTMLVideoElement, url: string) => {
                    if (Hls.isSupported()) {
                        if (this.hls) {
                            this.hls.destroy();
                        }
                        this.hls = new Hls();
                        this.hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                            this.handleHlsManifestParsed(url, data);
                        });
                        this.hls.on(Hls.Events.ERROR, (_, data) => {
                            this.handleHlsError(url, data);
                        });
                        this.hls.loadSource(url);
                        this.hls.attachMedia(video);
                        addHlsAudioTrackSettings(this.player, this.hls);
                    } else if (
                        video.canPlayType('application/vnd.apple.mpegurl')
                    ) {
                        video.src = url;
                    }
                },
                ts: (video: HTMLVideoElement, url: string) => {
                    if (mpegts.isSupported()) {
                        if (this.mpegtsPlayer) {
                            this.mpegtsPlayer.destroy();
                        }
                        this.mpegtsPlayer = mpegts.createPlayer({
                            type: 'mpegts',
                            isLive: true,
                            url: url,
                        });
                        this.mpegtsPlayer.attachMediaElement(video);
                        this.mpegtsPlayer.on(
                            mpegts.Events.ERROR,
                            (
                                type: string,
                                details: string,
                                info: unknown
                            ): void => {
                                this.playbackIssue.emit(
                                    classifyMpegTsPlaybackIssue(
                                        {
                                            type,
                                            details,
                                            info,
                                        },
                                        this.createSourceMetadata(
                                            url,
                                            'video/mp2t'
                                        )
                                    )
                                );
                            }
                        );
                        this.mpegtsPlayer.load();
                        this.mpegtsPlayer.play();
                    }
                },
                mkv: (video: HTMLVideoElement, url: string) => {
                    video.src = url;
                },
            },
        });

        this.player.video.addEventListener(
            'error',
            this.handleNativePlaybackError
        );
        this.player.video.addEventListener(
            'loadeddata',
            this.clearPlaybackIssue
        );
        this.player.video.addEventListener('playing', this.clearPlaybackIssue);
        this.player.video.addEventListener('ended', this.handlePlaybackEnded);

        if (this.startTime > 0) {
            this.player.on('ready', () => {
                this.player.seek = this.startTime;
            });
        }

        this.player.on('video:timeupdate', () => {
            this.timeUpdate.emit({
                currentTime: this.player.currentTime,
                duration: this.player.duration,
            });
        });
    }

    private applyVolume(value: number): void {
        this.player.volume = this.clampVolume(value);
    }

    private clampVolume(value: number): number {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return 1;
        }

        return Math.max(0, Math.min(1, numericValue));
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
            this.playbackIssue.emit(issue);
        }
    }

    private handleHlsError(url: string, data: ErrorData): void {
        if (!data.fatal) {
            return;
        }

        this.playbackIssue.emit(
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

    private getVideoType(url: string): string {
        const extension = getPlaybackMediaExtensionFromUrl(url);
        switch (extension) {
            case 'mkv':
                return 'video/matroska';
            case 'm3u8':
                return 'm3u8';
            case 'mp4':
                return 'mp4';
            case 'ts':
                return 'ts';
            default:
                // No recognized extension (e.g. IPTV proxy URL) → default to
                // MPEG-TS which is the most common format for live IPTV streams.
                return extension ? 'auto' : 'ts';
        }
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

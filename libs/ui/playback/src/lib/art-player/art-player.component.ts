import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    input,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    signal,
    SimpleChanges,
    viewChild,
} from '@angular/core';
import Artplayer from 'artplayer';
import { Channel, createDevLogger } from '@iptvnator/shared/interfaces';
import type { PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';
import {
    PlayerControlsComponent,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import {
    buildArtPlayerChrome,
    exitOwnedArtPlayerFullscreen,
    getArtPlayerVideoType,
    resolveArtPlayerIsLive,
} from './art-player-setup';
import { ArtPlayerSourceSession } from './art-player-source-session';
import { ArtPlayerVideoSession } from './art-player-video-session';

const debugArtPlayer = createDevLogger('ArtPlayer');

Artplayer.AUTO_PLAYBACK_TIMEOUT = 10000;

@Component({
    selector: 'app-art-player',
    imports: [
        PlayerControlsComponent,
        SeriesPlaybackNavigationControlsComponent,
    ],
    providers: [WebVideoControlsAdapter],
    templateUrl: './art-player.component.html',
    styleUrls: ['./art-player.component.scss'],
})
export class ArtPlayerComponent implements OnInit, OnDestroy, OnChanges {
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() showCaptions = false;
    @Input() startTime = 0;
    @Input() seriesNavigation: SeriesPlaybackNavigation | null = null;
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);

    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    @Output() playbackIssue = new EventEmitter<PlaybackDiagnostic | null>();
    @Output() playbackEnded = new EventEmitter<void>();
    @Output() previousEpisodeRequested = new EventEmitter<void>();
    @Output() nextEpisodeRequested = new EventEmitter<void>();

    readonly sharedControls = inject(WEB_PLAYER_SHARED_CONTROLS);
    readonly controlsAdapter = inject(WebVideoControlsAdapter);
    readonly playerRoot = viewChild<ElementRef<HTMLElement>>('playerRoot');
    private readonly artplayerContainer =
        viewChild.required<ElementRef<HTMLDivElement>>('artplayer');
    private readonly seriesNavigationSignal =
        signal<SeriesPlaybackNavigation | null>(null);

    private player: Artplayer | null = null;
    private sourceSession: ArtPlayerSourceSession | null = null;
    private videoSession: ArtPlayerVideoSession | null = null;

    ngOnInit(): void {
        this.seriesNavigationSignal.set(this.seriesNavigation);
        if (this.sharedControls) {
            this.controlsAdapter.setContext({
                seriesNavigation: this.seriesNavigationSignal,
            });
        }
        this.initPlayer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['seriesNavigation']) {
            this.seriesNavigationSignal.set(this.seriesNavigation);
        }

        const channelChanged =
            changes['channel'] && !changes['channel'].firstChange;
        const authoritativeLiveChanged =
            this.sharedControls &&
            changes['isLive'] &&
            !changes['isLive'].firstChange &&
            changes['isLive'].previousValue !== changes['isLive'].currentValue;
        if (this.player && (channelChanged || authoritativeLiveChanged)) {
            this.destroyPlayer();
            this.initPlayer();
        }

        if (changes['showCaptions']) {
            this.sourceSession?.refreshInputs();
        }
        if (changes['interactionEnabled']?.currentValue === false) {
            exitOwnedArtPlayerFullscreen(
                this.sharedControls,
                this.playerRoot()?.nativeElement,
                (error) =>
                    debugArtPlayer(
                        'Failed to exit ArtPlayer fullscreen:',
                        error
                    )
            );
        }
        if (changes['volume']?.currentValue !== undefined && this.player) {
            this.applyVolume(changes['volume'].currentValue);
        }
    }

    ngOnDestroy(): void {
        this.destroyPlayer();
    }

    private initPlayer(): void {
        this.playbackIssue.emit(null);
        const sourceUrl = this.channel.url + (this.channel.epgParams ?? '');
        const sourceSession = new ArtPlayerSourceSession({
            sharedControls: this.sharedControls,
            controlsAdapter: this.controlsAdapter,
            isLive: () => this.isLive(),
            showCaptions: () => this.showCaptions,
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
        });
        this.sourceSession = sourceSession;

        const player = new Artplayer({
            container: this.artplayerContainer().nativeElement,
            url: sourceUrl,
            volume: this.clampVolume(this.volume),
            isLive: resolveArtPlayerIsLive(
                this.sharedControls,
                this.isLive(),
                this.channel.url
            ),
            autoplay: true,
            type: getArtPlayerVideoType(this.channel.url),
            playsInline: true,
            backdrop: true,
            mutex: true,
            theme: '#ff0000',
            ...buildArtPlayerChrome(this.sharedControls),
            customType: sourceSession.customType,
        });
        this.player = player;
        sourceSession.attach(player);

        const videoSession = new ArtPlayerVideoSession({
            player,
            sourceUrl: this.channel.url,
            getStartTime: () => this.startTime,
            getDuration: () => sourceSession.resolveDuration(player.duration),
            persistSharedVolume: this.sharedControls,
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
            emitTimeUpdate: (value) => this.timeUpdate.emit(value),
            emitPlaybackEnded: () => this.playbackEnded.emit(),
        });
        this.videoSession = videoSession;
        videoSession.attach();

        // ArtPlayer synchronously restores `artplayer_settings.volume` after
        // applying the constructor option. Shared controls use the app-wide
        // volume as authoritative, so reapply it directly to the media element.
        if (this.sharedControls) {
            this.applyVolume(this.volume);
        }
    }

    private destroyPlayer(): void {
        const sourceSession = this.sourceSession;
        this.sourceSession = null;
        sourceSession?.destroy();

        const videoSession = this.videoSession;
        this.videoSession = null;
        videoSession?.destroy();

        const player = this.player;
        this.player = null;
        player?.destroy();
    }

    private applyVolume(value: number): void {
        const player = this.player;
        if (!player) {
            return;
        }

        const volume = this.clampVolume(value);
        if (this.sharedControls) {
            player.video.volume = volume;
            player.video.muted = volume <= 0;
        } else {
            player.volume = volume;
        }
    }

    private clampVolume(value: number): number {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return 1;
        }
        return Math.max(0, Math.min(1, numericValue));
    }
}

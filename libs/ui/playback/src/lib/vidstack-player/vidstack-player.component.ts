import { DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewEncapsulation,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import type { MediaProviderChangeEvent } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';
import { Channel, createDevLogger } from '@iptvnator/shared/interfaces';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import {
    type LegacyPlayerShortcuts,
    PlayerControlsComponent,
    type PlayerMediaTitle,
    PlayerUpNextItem,
    type PlayerTimelineSegment,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { releaseVideoPictureInPicture } from '../player-controls/web-video-picture-in-picture-lifecycle';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { loadVidstackElements } from './vidstack-elements';
import { loadVidstackLayoutTheme } from './vidstack-layout-theme';
import { attachVidstackLegacyShortcuts } from './vidstack-legacy-shortcuts';
import {
    createVidstackPlayerElement,
    createVidstackStorage,
    exitOwnedVidstackFullscreen,
    formatVidstackTitle,
    resolveVidstackSource,
} from './vidstack-player-setup';
import { VidstackSourceSession } from './vidstack-source-session';
import { VidstackVideoSession } from './vidstack-video-session';

const debugVidstack = createDevLogger('Vidstack');

@Component({
    selector: 'app-vidstack-player',
    imports: [
        PlayerControlsComponent,
        SeriesPlaybackNavigationControlsComponent,
    ],
    providers: [WebVideoControlsAdapter],
    templateUrl: './vidstack-player.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./vidstack-player.component.scss'],
    // Vidstack renders into light DOM that Angular never compiles, so the
    // sizing rules are scoped under the shell class instead of emulated.
    encapsulation: ViewEncapsulation.None,
})
export class VidstackPlayerComponent implements OnInit, OnDestroy, OnChanges {
    readonly channel = input.required<Channel>();
    readonly volume = input(1);
    readonly showCaptions = input(false);
    readonly startTime = input(0);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    readonly isLive = input(true);
    readonly interactionEnabled = input(true);
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly upNext = input<PlayerUpNextItem | null>(null);
    /** Catch-up programmes drawn as track segments; null draws one. */
    readonly timelineSegments = input<readonly PlayerTimelineSegment[] | null>(
        null
    );
    /** See `PlayerControlsComponent.fullscreenTarget`; null keeps the shell. */
    readonly fullscreenTarget = input<HTMLElement | null>(null);

    readonly timeUpdate = output<PlayerTimeUpdate>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly playbackStarted = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    readonly sharedControls = inject(WEB_PLAYER_SHARED_CONTROLS);
    readonly controlsAdapter = inject(WebVideoControlsAdapter);
    /** The preference-off layout stays hidden until its theme has loaded. */
    readonly layoutThemeReady = signal(false);
    private readonly document = inject(DOCUMENT);
    readonly playerRoot = viewChild<ElementRef<HTMLElement>>('playerRoot');
    private readonly vidstackContainer =
        viewChild.required<ElementRef<HTMLDivElement>>('vidstack');
    private readonly seriesNavigationSignal =
        signal<SeriesPlaybackNavigation | null>(null);

    private player: MediaPlayerElement | null = null;
    /** Invalidates a mount still waiting for the Vidstack elements. */
    private mountGeneration = 0;
    private sourceSession: VidstackSourceSession | null = null;
    private videoSession: VidstackVideoSession | null = null;
    private legacyShortcuts: LegacyPlayerShortcuts | null = null;

    private readonly handleProviderChange = (event: Event): void => {
        const provider = (event as MediaProviderChangeEvent).detail;
        const video = this.sourceSession?.attachProvider(provider) ?? null;
        if (video && this.videoSession?.video !== video) {
            this.attachVideoSession(video);
        }
    };

    ngOnInit(): void {
        this.seriesNavigationSignal.set(this.seriesNavigation());
        if (this.sharedControls) {
            this.controlsAdapter.setContext({
                seriesNavigation: this.seriesNavigationSignal,
            });
        } else {
            void loadVidstackLayoutTheme(this.document).then(() =>
                this.layoutThemeReady.set(true)
            );
            // Survives the channel-change destroy/init cycle: the handlers
            // read the current player lazily.
            this.legacyShortcuts = attachVidstackLegacyShortcuts({
                player: () => this.player,
                hostElement: () => this.playerRoot()?.nativeElement ?? null,
                isAvailable: () => this.interactionEnabled(),
                isLive: () => this.isLive(),
            });
        }
        this.initPlayer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['seriesNavigation']) {
            this.seriesNavigationSignal.set(this.seriesNavigation());
        }

        // The stream type and the MPEG-TS engine both follow `isLive`, so a
        // corrected live/VOD answer rebuilds the player in either mode.
        const channelChanged =
            changes['channel'] && !changes['channel'].firstChange;
        const liveChanged =
            changes['isLive'] &&
            !changes['isLive'].firstChange &&
            changes['isLive'].previousValue !== changes['isLive'].currentValue;
        if (this.player && (channelChanged || liveChanged)) {
            this.destroyPlayer();
            this.initPlayer();
        } else if (this.player && changes['mediaTitle']) {
            this.player.title = this.resolveTitle();
        }

        if (changes['showCaptions']) {
            this.sourceSession?.refreshInputs();
        }
        if (changes['interactionEnabled']?.currentValue === false) {
            exitOwnedVidstackFullscreen(
                this.sharedControls,
                this.fullscreenTarget() ?? this.playerRoot()?.nativeElement,
                (error) =>
                    debugVidstack('Failed to exit Vidstack fullscreen:', error)
            );
        }
        if (changes['volume']?.currentValue !== undefined && this.player) {
            this.applyVolume(changes['volume'].currentValue);
        }
    }

    ngOnDestroy(): void {
        this.legacyShortcuts?.detach();
        this.legacyShortcuts = null;
        this.destroyPlayer();
    }

    private initPlayer(): void {
        this.playbackIssue.emit(null);
        const generation = ++this.mountGeneration;
        loadVidstackElements(!this.sharedControls).then(
            () => {
                if (generation === this.mountGeneration) {
                    this.mountPlayer();
                }
            },
            (error: unknown) =>
                debugVidstack('Failed to load the Vidstack player:', error)
        );
    }

    /** Reads the inputs current at mount time, not at `initPlayer()`. */
    private mountPlayer(): void {
        const channel = this.channel();
        const source = resolveVidstackSource(
            channel.url + (channel.epgParams ?? '')
        );
        this.sourceSession = new VidstackSourceSession({
            source,
            sharedControls: this.sharedControls,
            controlsAdapter: this.controlsAdapter,
            isLive: () => this.isLive(),
            showCaptions: () => this.showCaptions(),
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
            getDrm: () => this.channel().drm,
        });

        const container = this.vidstackContainer().nativeElement;
        const player = createVidstackPlayerElement({
            source,
            isLive: this.isLive(),
            title: this.resolveTitle(),
            storage: createVidstackStorage({
                getVolume: () => clampVolume(this.volume()),
                getStartTime: () => this.startTime(),
                showCaptions: () => this.showCaptions(),
            }),
            defaultLayoutMenuContainer: this.sharedControls ? null : container,
        });
        // Vidstack announces the provider before setting it up; listening
        // before the player connects is what lets the session configure it.
        player.addEventListener('provider-change', this.handleProviderChange);
        this.player = player;
        container.append(player);
    }

    private attachVideoSession(video: HTMLVideoElement): void {
        this.videoSession?.destroy();
        const channelUrl = this.channel().url;
        this.videoSession = new VidstackVideoSession({
            video,
            sourceUrl: channelUrl,
            getDuration: () =>
                this.sourceSession?.resolveDuration(video.duration) ??
                video.duration,
            emitPlaybackIssue: (issue) => this.playbackIssue.emit(issue),
            emitTimeUpdate: (value) => this.timeUpdate.emit(value),
            emitPlaybackEnded: () => this.playbackEnded.emit(),
            emitPlaybackStarted: () => this.playbackStarted.emit(),
        });
        this.videoSession.attach();
    }

    private destroyPlayer(): void {
        this.mountGeneration += 1;
        const player = this.player;
        this.player = null;
        player?.removeEventListener('provider-change', this.handleProviderChange);

        if (!this.sharedControls) {
            releaseVideoPictureInPicture(this.videoSession?.video);
        }
        const sourceSession = this.sourceSession;
        this.sourceSession = null;
        sourceSession?.destroy();

        const videoSession = this.videoSession;
        this.videoSession = null;
        videoSession?.destroy();

        if (player) {
            player.destroy();
            player.remove();
        }
    }

    private applyVolume(value: number): void {
        const player = this.player;
        if (!player) {
            return;
        }
        const volume = clampVolume(value);
        player.volume = volume;
        player.muted = volume <= 0;
    }

    private resolveTitle(): string {
        const channel = this.channel();
        const fallback =
            channel.name && channel.name !== channel.url ? channel.name : '';
        return formatVidstackTitle(this.mediaTitle(), fallback);
    }
}

function clampVolume(value: number): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 1;
    }
    return Math.max(0, Math.min(1, numericValue));
}

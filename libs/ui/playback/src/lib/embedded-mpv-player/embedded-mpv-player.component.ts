import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import {
    EmbeddedMpvAudioTrack,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { EmbeddedMpvOverlayVisibilityService } from './embedded-mpv-overlay-visibility.service';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';
import { EmbeddedMpvShortcuts } from './embedded-mpv-shortcuts';
import {
    EmbeddedMpvFeedback,
    EmbeddedMpvMenuState,
} from './embedded-mpv-ui-state';
import {
    ASPECT_PRESETS,
    HIDDEN_BOUNDS,
    MENU_OPEN_BOTTOM_CUTOUT_PX,
    SPEED_PRESETS,
    aspectLabel,
    audioTrackLabel,
    formatTime,
    measureBounds,
    persistVolume,
    readStoredVolume,
    speedLabel,
    subtitleTrackLabel,
    volumeIcon,
} from './embedded-mpv-format.utils';

const HIDE_CONTROLS_DELAY_MS = 2500;
const RECORDING_MESSAGE_DISMISS_DELAY_MS = 5000;
const VOLUME_POPOVER_CLOSE_DELAY_MS = 220;
const VIEWPORT_CLICK_PAUSE_DELAY_MS = 250;

@Component({
    selector: 'app-embedded-mpv-player',
    templateUrl: './embedded-mpv-player.component.html',
    styleUrl: './embedded-mpv-player.component.scss',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    providers: [EmbeddedMpvSessionController],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'embedded-mpv-player-host',
    },
})
export class EmbeddedMpvPlayerComponent implements OnDestroy {
    readonly playback = input.required<ResolvedPortalPlayback>();
    readonly showControls = input(true);
    readonly recordingFolder = input('');
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);

    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    private readonly overlayVisibility = inject(
        EmbeddedMpvOverlayVisibilityService
    );
    private readonly translate = inject(TranslateService);
    /**
     * Ticks when the active language or a loaded translation file changes.
     * translate.instant() is invisible to the signal graph, so every
     * computed()/template helper that calls it must read this signal first —
     * otherwise labels keep the previous language (or the raw key when the
     * component mounts before the translation file finishes loading).
     */
    private readonly translationsTick = toSignal(
        merge(
            this.translate.onLangChange,
            this.translate.onTranslationChange,
            this.translate.onDefaultLangChange
        ),
        { initialValue: null }
    );
    private readonly controller = inject(EmbeddedMpvSessionController);
    private readonly shortcuts = new EmbeddedMpvShortcuts();
    readonly menus = new EmbeddedMpvMenuState();
    readonly feedback = new EmbeddedMpvFeedback();

    readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
    readonly playerRoot = viewChild<ElementRef<HTMLDivElement>>('playerRoot');

    readonly support = this.controller.support;
    readonly session = this.controller.session;
    readonly stalled = this.controller.stalled;

    readonly volume = signal(readStoredVolume());
    readonly isFullscreen = signal(false);
    readonly controlsVisible = signal(true);

    readonly speedPresets = SPEED_PRESETS;
    readonly aspectPresets = ASPECT_PRESETS;

    readonly isSupported = computed(() => this.support()?.supported ?? false);
    readonly isFrameCopyEngine = computed(
        () => this.support()?.engine === 'frame-copy'
    );
    readonly capabilities = computed(
        () =>
            this.support()?.capabilities ?? {
                subtitles: false,
                playbackSpeed: false,
                aspectOverride: false,
                screenshot: false,
                recording: false,
            }
    );
    readonly isLoading = computed(
        () =>
            !this.support() ||
            this.session()?.status === 'loading' ||
            (!this.session() && this.isSupported())
    );
    readonly isPaused = computed(
        () =>
            this.session()?.status === 'paused' ||
            this.session()?.status === 'idle' ||
            this.session()?.status === 'ended'
    );
    readonly isPlaying = computed(() => this.session()?.status === 'playing');
    readonly isErrored = computed(() => this.session()?.status === 'error');
    readonly isLivePlayback = computed(() => {
        const playback = this.playback();
        if (typeof playback.isLive === 'boolean') {
            return playback.isLive;
        }

        return !playback.contentInfo;
    });
    readonly canSeek = computed(
        () =>
            !this.isLivePlayback() && (this.session()?.durationSeconds ?? 0) > 0
    );
    readonly canFullscreen = computed(
        () =>
            typeof document !== 'undefined' &&
            Boolean(this.playerRoot()?.nativeElement.requestFullscreen) &&
            Boolean(document.exitFullscreen)
    );
    readonly statusLabel = computed(() => {
        this.translationsTick();
        const session = this.session();
        if (session?.status === 'error') {
            return (
                session.error ??
                this.translate.instant('EMBEDDED_MPV.PLAYER.PLAYBACK_FAILED')
            );
        }
        if (!this.support()) {
            return this.translate.instant(
                'EMBEDDED_MPV.PLAYER.CHECKING_SUPPORT'
            );
        }
        if (!this.isSupported()) {
            return (
                this.support()?.reason ??
                this.translate.instant('EMBEDDED_MPV.PLAYER.NOT_AVAILABLE')
            );
        }
        if (!session || session.status === 'loading') {
            return this.translate.instant(
                'EMBEDDED_MPV.PLAYER.LOADING_STREAM'
            );
        }
        return '';
    });
    readonly fullscreenLabel = computed(() => {
        this.translationsTick();
        return this.translate.instant(
            this.isFullscreen()
                ? 'EMBEDDED_MPV.PLAYER.EXIT_FULLSCREEN'
                : 'EMBEDDED_MPV.PLAYER.ENTER_FULLSCREEN'
        );
    });
    readonly audioTracks = computed(() => this.session()?.audioTracks ?? []);
    readonly hasAudioTracks = computed(() => this.audioTracks().length > 1);
    readonly subtitleTracks = computed(
        () => this.session()?.subtitleTracks ?? []
    );
    readonly hasSubtitleTracks = computed(
        () => this.subtitleTracks().length > 0
    );
    readonly selectedSubtitleTrackId = computed(
        () => this.session()?.selectedSubtitleTrackId ?? null
    );
    readonly playbackSpeed = computed(() => this.session()?.playbackSpeed ?? 1);
    readonly aspectOverride = computed(
        () => this.session()?.aspectOverride ?? 'no'
    );
    readonly volumeIcon = computed(() => volumeIcon(this.volume()));
    readonly volumeLabel = computed(() => {
        this.translationsTick();
        return this.translate.instant('EMBEDDED_MPV.PLAYER.VOLUME_LABEL', {
            percent: Math.round(this.volume() * 100),
        });
    });
    /**
     * Non-null while the user drags the timeline: the slider and time label
     * preview this value locally and the single seek IPC call is deferred to
     * the release (`change`) event instead of firing per drag pixel.
     */
    readonly scrubPosition = signal<number | null>(null);
    readonly timelineValue = computed(
        () =>
            this.scrubPosition() ??
            Math.max(0, this.session()?.positionSeconds ?? 0)
    );
    readonly controlsAreVisible = computed(
        () =>
            this.showControls() &&
            this.isSupported() &&
            (this.controlsVisible() ||
                this.isLoading() ||
                this.isPaused() ||
                this.menus.anyOpen() ||
                Boolean(this.statusLabel()))
    );
    readonly hideCursor = computed(
        () =>
            this.isFullscreen() &&
            this.isPlaying() &&
            !this.controlsAreVisible()
    );
    readonly canRecord = computed(
        () =>
            this.capabilities().recording &&
            this.isLivePlayback() &&
            this.isSupported() &&
            !this.isErrored()
    );
    readonly isRecording = computed(
        () => this.session()?.recording?.active === true
    );
    readonly showSeriesNavigation = computed(
        () => !this.isLivePlayback() && this.seriesNavigation() !== null
    );
    readonly canPreviousEpisode = computed(
        () =>
            this.showSeriesNavigation() &&
            this.seriesNavigation()?.canPrevious === true
    );
    readonly canNextEpisode = computed(
        () =>
            this.showSeriesNavigation() &&
            this.seriesNavigation()?.canNext === true
    );
    readonly recordingElapsed = computed(() => {
        const startedAt = this.session()?.recording?.startedAt;
        this.recordingTick();
        if (!startedAt) {
            return 0;
        }
        const startedAtMs = Date.parse(startedAt);
        if (!Number.isFinite(startedAtMs)) {
            return 0;
        }
        return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    });
    readonly recordingStatusText = computed(() => {
        if (this.isRecording()) {
            return `REC ${formatTime(this.recordingElapsed())}`;
        }
        return this.recordingMessage();
    });

    private mutedVolume = 0;
    private controlsHideTimer: number | null = null;
    private volumeCloseTimer: number | null = null;
    private recordingMessageTimer: number | null = null;
    private viewportClickTimer: number | null = null;
    private lastEndedSessionId: string | null = null;
    private readonly recordingTick = signal(Date.now());
    private readonly recordingMessage = signal<string | null>(null);

    private readonly onDocumentPointerDown = (event: PointerEvent) => {
        const playerRoot = this.playerRoot()?.nativeElement;
        if (!playerRoot || event.composedPath().includes(playerRoot)) {
            return;
        }
        this.closePopovers();
    };
    private readonly onDocumentPointerMove = (event: PointerEvent) => {
        const playerRoot = this.playerRoot()?.nativeElement;
        if (
            playerRoot &&
            !event.composedPath().includes(playerRoot) &&
            this.isPointerInsidePlayer(event)
        ) {
            this.revealControls();
        }
    };
    private readonly onFullscreenChange = () => {
        const playerRoot = this.playerRoot()?.nativeElement;
        this.isFullscreen.set(
            Boolean(playerRoot && document.fullscreenElement === playerRoot)
        );
        this.revealControls();
        this.controller.triggerBoundsSync();
    };

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
            document.addEventListener(
                'pointerdown',
                this.onDocumentPointerDown
            );
            document.addEventListener(
                'pointermove',
                this.onDocumentPointerMove,
                { passive: true }
            );
        }

        this.controller.setBoundsProvider((host) => {
            // The frame-copy engine paints into an ordinary DOM canvas:
            // dialogs and popovers stack above it natively, so the
            // hide-offscreen and popover-cutout compositor workarounds
            // must not shrink its render size.
            if (this.isFrameCopyEngine()) {
                return measureBounds(host);
            }
            if (this.overlayVisibility.overlayActive()) {
                return HIDDEN_BOUNDS;
            }
            const rect = measureBounds(host);
            if (this.menus.anyOpen()) {
                return {
                    ...rect,
                    height: Math.max(
                        1,
                        rect.height - MENU_OPEN_BOTTOM_CUTOUT_PX
                    ),
                };
            }
            return rect;
        });

        this.shortcuts.attach({
            isAvailable: () => !this.overlayVisibility.overlayActive(),
            onEscape: () => this.closePopovers(),
            togglePaused: () => void this.togglePaused(),
            toggleFullscreen: () => void this.toggleFullscreen(),
            seekBy: (delta) => void this.seekBy(delta),
            adjustVolume: (delta) => this.adjustVolume(delta),
            toggleMute: () => this.toggleMute(),
        });

        effect((onCleanup) => {
            const viewport = this.viewport();
            const playback = this.playback();
            const supported = this.isSupported();
            this.controller.retryToken();

            if (
                !viewport ||
                !playback.streamUrl ||
                !supported ||
                !window.electron
            ) {
                return;
            }

            // volume is read untracked so adjusting it during playback does
            // not re-trigger this effect (which would tear down and recreate
            // the session, restarting the stream from the beginning).
            // Subsequent volume changes flow through controller.applyVolume.
            this.setRecordingMessage(null);
            const teardown = this.controller.startSession(
                viewport.nativeElement,
                playback,
                untracked(() => this.volume())
            );
            onCleanup(teardown);
        });

        effect(() => {
            this.overlayVisibility.overlayActive();
            this.menus.anyOpen();
            this.controller.triggerBoundsSync();
        });

        effect(() => {
            const session = this.session();
            if (!session) {
                this.lastEndedSessionId = null;
                return;
            }
            // Side effects must not pull in transitive signal deps via
            // scheduleControlsHide — otherwise opening a popover, pausing, or
            // hovering would re-run this body and re-emit timeUpdate (which
            // could feed back into playback inputs and restart the stream).
            untracked(() => {
                this.volume.set(session.volume);
                this.timeUpdate.emit({
                    currentTime: session.positionSeconds,
                    duration: session.durationSeconds ?? 0,
                });
                this.scheduleControlsHide();
            });
        });

        effect(() => {
            const session = this.session();
            if (!session || session.status !== 'ended') {
                return;
            }
            if (this.lastEndedSessionId === session.id) {
                return;
            }

            this.lastEndedSessionId = session.id;
            this.playbackEnded.emit();
        });

        effect((onCleanup) => {
            if (!this.isRecording()) {
                return;
            }
            this.recordingTick.set(Date.now());
            const intervalId = window.setInterval(
                () => this.recordingTick.set(Date.now()),
                1000
            );
            onCleanup(() => window.clearInterval(intervalId));
        });
    }

    ngOnDestroy(): void {
        this.shortcuts.detach();
        this.feedback.dispose();
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
            document.removeEventListener(
                'pointerdown',
                this.onDocumentPointerDown
            );
            document.removeEventListener(
                'pointermove',
                this.onDocumentPointerMove
            );
        }
        if (this.volumeCloseTimer !== null) {
            clearTimeout(this.volumeCloseTimer);
            this.volumeCloseTimer = null;
        }
        this.clearRecordingMessageTimer();
        this.clearControlsHideTimer();
        this.clearViewportClickTimer();
    }

    private clearViewportClickTimer(): void {
        if (this.viewportClickTimer !== null) {
            window.clearTimeout(this.viewportClickTimer);
            this.viewportClickTimer = null;
        }
    }

    onPlayerInteraction(): void {
        this.revealControls();
    }

    onViewportClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, [role="slider"]')) {
            return;
        }
        if (this.menus.anyOpen()) {
            this.menus.closeAll();
            return;
        }
        if (this.isLoading() || this.isErrored() || this.stalled()) {
            return;
        }
        // The pause is deferred so a double-click (fullscreen) can cancel it;
        // pause feedback is the transport icon in the dock — the native video
        // surface paints over any DOM overlay we could flash here.
        this.clearViewportClickTimer();
        this.viewportClickTimer = window.setTimeout(() => {
            this.viewportClickTimer = null;
            void this.togglePaused();
        }, VIEWPORT_CLICK_PAUSE_DELAY_MS);
    }

    onPlayerDblClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, [role="slider"]')) {
            return;
        }
        this.clearViewportClickTimer();
        void this.toggleFullscreen();
    }

    async togglePaused(): Promise<void> {
        this.revealControls();
        await this.controller.togglePaused();
    }

    async toggleFullscreen(): Promise<void> {
        this.revealControls();
        const playerRoot = this.playerRoot()?.nativeElement;
        if (!playerRoot || !this.canFullscreen()) {
            return;
        }
        try {
            if (document.fullscreenElement === playerRoot) {
                await document.exitFullscreen();
            } else {
                await playerRoot.requestFullscreen();
            }
        } catch {
            return;
        } finally {
            this.controller.triggerBoundsSync();
        }
    }

    async seekBy(deltaSeconds: number): Promise<void> {
        this.revealControls();
        const ok = await this.controller.seekBy(deltaSeconds);
        if (ok) {
            this.feedback.flash(
                deltaSeconds >= 0 ? 'forward_10' : 'replay_10',
                `${deltaSeconds >= 0 ? '+' : ''}${Math.round(deltaSeconds)}s`
            );
        }
    }

    requestPreviousEpisode(): void {
        this.revealControls();
        if (!this.canPreviousEpisode()) {
            return;
        }
        this.previousEpisodeRequested.emit();
    }

    requestNextEpisode(): void {
        this.revealControls();
        if (!this.canNextEpisode()) {
            return;
        }
        this.nextEpisodeRequested.emit();
    }

    onTimelineInput(event: Event): void {
        this.revealControls();
        this.scrubPosition.set(
            Number((event.target as HTMLInputElement).value)
        );
    }

    async onTimelineCommit(event: Event): Promise<void> {
        const target = Number((event.target as HTMLInputElement).value);
        this.scrubPosition.set(null);
        await this.controller.seekTo(target);
    }

    onVolumeInput(event: Event): void {
        const next = Number((event.target as HTMLInputElement).value);
        this.applyVolume(next);
        this.revealControls(false);
    }

    onVolumeWheel(event: WheelEvent): void {
        event.preventDefault();
        this.adjustVolume(event.deltaY > 0 ? -0.05 : 0.05);
    }

    onVolumeHoverEnter(): void {
        if (this.volumeCloseTimer !== null) {
            clearTimeout(this.volumeCloseTimer);
            this.volumeCloseTimer = null;
        }
        this.menus.open('volume');
    }

    onVolumeHoverLeave(): void {
        if (this.volumeCloseTimer !== null) {
            clearTimeout(this.volumeCloseTimer);
        }
        this.volumeCloseTimer = window.setTimeout(() => {
            this.menus.close('volume');
            this.volumeCloseTimer = null;
        }, VOLUME_POPOVER_CLOSE_DELAY_MS);
    }

    toggleMute(): void {
        const current = this.volume();
        if (current > 0) {
            this.mutedVolume = current;
            this.applyVolume(0);
            this.feedback.flash(
                'volume_off',
                this.translate.instant('EMBEDDED_MPV.PLAYER.MUTED')
            );
        } else {
            const restored = this.mutedVolume || 0.5;
            this.applyVolume(restored);
            this.feedback.flash(
                volumeIcon(restored),
                `${Math.round(restored * 100)}%`
            );
        }
        this.revealControls();
    }

    toggleAudioMenu(): void {
        this.menus.toggle('audio');
        this.revealControls();
    }
    toggleSubtitleMenu(): void {
        this.menus.toggle('subtitle');
        this.revealControls();
    }
    toggleSpeedMenu(): void {
        this.menus.toggle('speed');
        this.revealControls();
    }
    toggleAspectMenu(): void {
        this.menus.toggle('aspect');
        this.revealControls();
    }

    async selectAudioTrack(trackId: number): Promise<void> {
        this.revealControls(false);
        await this.controller.setAudioTrack(trackId);
        this.menus.close('audio');
        this.scheduleControlsHide();
    }

    async selectSubtitleTrack(trackId: number): Promise<void> {
        this.revealControls(false);
        await this.controller.setSubtitleTrack(trackId);
        this.menus.close('subtitle');
        this.scheduleControlsHide();
    }

    async selectSpeed(speed: number): Promise<void> {
        this.revealControls(false);
        await this.controller.setSpeed(speed);
        this.menus.close('speed');
        this.scheduleControlsHide();
    }

    async selectAspect(aspect: string): Promise<void> {
        this.revealControls(false);
        await this.controller.setAspect(aspect);
        this.menus.close('aspect');
        this.scheduleControlsHide();
    }

    async toggleRecording(): Promise<void> {
        if (!this.canRecord()) {
            return;
        }

        this.revealControls(false);
        if (this.isRecording()) {
            const recording = await this.controller.stopRecording();
            if (recording?.targetPath) {
                this.setRecordingMessage(
                    this.translate.instant('EMBEDDED_MPV.PLAYER.SAVED_TO', {
                        path: recording.targetPath,
                    }),
                    {
                        autoDismiss: true,
                    }
                );
                this.feedback.flash(
                    'check_circle',
                    this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING_SAVED'
                    ),
                    1200
                );
            } else if (recording?.error) {
                this.setRecordingMessage(recording.error);
                this.flashRecordingFailed();
            } else {
                this.setRecordingMessage(
                    this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_STOP'
                    )
                );
                this.flashRecordingFailed();
            }
            this.scheduleControlsHide();
            return;
        }

        this.setRecordingMessage(null);
        const recording = await this.controller.startRecording(
            this.recordingFolder(),
            this.playback().title
        );
        if (recording?.active) {
            this.feedback.flash(
                'fiber_manual_record',
                this.translate.instant('EMBEDDED_MPV.PLAYER.RECORDING'),
                900
            );
        } else if (recording?.error) {
            this.setRecordingMessage(recording.error);
            this.flashRecordingFailed();
        } else {
            this.setRecordingMessage(
                this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_START'
                )
            );
            this.flashRecordingFailed();
        }
    }

    private flashRecordingFailed(): void {
        this.feedback.flash(
            'error_outline',
            this.translate.instant('EMBEDDED_MPV.PLAYER.RECORDING_FAILED'),
            1200
        );
    }

    retry(): void {
        this.controller.retry();
    }

    // These helpers run inside the template's reactive context, so the
    // translationsTick() read makes them re-evaluate on language changes.
    formatTime = formatTime;
    trackLabel = (track: EmbeddedMpvAudioTrack, index: number) => {
        this.translationsTick();
        return audioTrackLabel(track, index, {
            fallback: this.translate.instant(
                'EMBEDDED_MPV.PLAYER.AUDIO_TRACK_FALLBACK',
                { index: index + 1 }
            ),
            defaultLabel: this.translate.instant(
                'EMBEDDED_MPV.PLAYER.TRACK_DEFAULT'
            ),
        });
    };
    subtitleLabel = (track: EmbeddedMpvAudioTrack, index: number) => {
        this.translationsTick();
        return subtitleTrackLabel(track, index, {
            fallback: this.translate.instant(
                'EMBEDDED_MPV.PLAYER.SUBTITLE_TRACK_FALLBACK',
                { index: index + 1 }
            ),
            defaultLabel: this.translate.instant(
                'EMBEDDED_MPV.PLAYER.TRACK_DEFAULT'
            ),
        });
    };
    speedLabel = speedLabel;
    aspectLabel = (aspect: string) => {
        this.translationsTick();
        return aspect === 'no'
            ? this.translate.instant('EMBEDDED_MPV.PLAYER.ASPECT_DEFAULT')
            : aspectLabel(aspect);
    };

    private setRecordingMessage(
        message: string | null,
        options: { autoDismiss?: boolean } = {}
    ): void {
        this.clearRecordingMessageTimer();
        this.recordingMessage.set(message);

        if (!message || !options.autoDismiss) {
            return;
        }

        this.recordingMessageTimer = window.setTimeout(() => {
            if (this.recordingMessage() === message) {
                this.recordingMessage.set(null);
            }
            this.recordingMessageTimer = null;
        }, RECORDING_MESSAGE_DISMISS_DELAY_MS);
    }

    private clearRecordingMessageTimer(): void {
        if (this.recordingMessageTimer === null) {
            return;
        }
        window.clearTimeout(this.recordingMessageTimer);
        this.recordingMessageTimer = null;
    }

    private adjustVolume(delta: number): void {
        const next = Math.max(0, Math.min(1, this.volume() + delta));
        this.applyVolume(next);
        this.revealControls();
        this.feedback.flash(volumeIcon(next), `${Math.round(next * 100)}%`);
    }

    private applyVolume(value: number): void {
        this.volume.set(value);
        persistVolume(value);
        void this.controller.applyVolume(value);
    }

    private closePopovers(): void {
        if (!this.menus.anyOpen()) {
            return;
        }
        this.menus.closeAll();
        this.controller.triggerBoundsSync();
        this.scheduleControlsHide();
    }

    private revealControls(scheduleHide = true): void {
        this.controlsVisible.set(true);
        if (scheduleHide) {
            this.clearControlsHideTimer();
            this.scheduleControlsHide();
        }
    }

    private scheduleControlsHide(): void {
        if (
            !this.isPlaying() ||
            this.menus.anyOpen() ||
            Boolean(this.statusLabel())
        ) {
            this.clearControlsHideTimer();
            return;
        }
        if (!this.controlsVisible() || this.controlsHideTimer !== null) {
            return;
        }
        this.controlsHideTimer = window.setTimeout(() => {
            if (
                this.isPlaying() &&
                !this.menus.anyOpen() &&
                !this.statusLabel()
            ) {
                this.controlsVisible.set(false);
            }
        }, HIDE_CONTROLS_DELAY_MS);
    }

    private clearControlsHideTimer(): void {
        if (this.controlsHideTimer === null) {
            return;
        }
        window.clearTimeout(this.controlsHideTimer);
        this.controlsHideTimer = null;
    }

    private isPointerInsidePlayer(event: PointerEvent): boolean {
        const playerRoot = this.playerRoot()?.nativeElement;
        if (!playerRoot) {
            return false;
        }
        const rect = playerRoot.getBoundingClientRect();
        return (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
        );
    }
}

export type EmbeddedMpvAudioTrackView = EmbeddedMpvAudioTrack;

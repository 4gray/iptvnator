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
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ControlsChromeInteractions } from './controls-chrome-interactions';
import { ControlsFeedback } from './controls-feedback';
import { ControlsFullscreen } from './controls-fullscreen';
import { ControlsMenuSelection } from './controls-menu-selection';
import { type ControlsMenu, ControlsMenuState } from './controls-menu-state';
import { ControlsShortcuts } from './controls-shortcuts';
import { ControlsStreamStats } from './controls-stream-stats';
import { ControlsSurface } from './controls-surface';
import { ControlsTimeline } from './controls-timeline';
import { ControlsVisibility } from './controls-visibility';
import { createControlsViewModel } from './controls-view-model';
import { ControlsVolume } from './controls-volume';
import { ControlsVolumeInteractions } from './controls-volume-interactions';
import { ControlsSubtitleSettings } from './controls-subtitle-settings';
import { formatTime, speedLabel } from './controls-format.utils';
import type {
    PlayerController,
    PlayerMediaTitle,
} from './player-controls.model';
import {
    SUBTITLE_COLOR_PRESETS,
    SUBTITLE_DELAY_STEP_SECONDS,
    SUBTITLE_SIZE_PRESETS,
    subtitleDelayLabel,
} from './subtitle-style';

@Component({
    selector: 'app-player-controls',
    templateUrl: './player-controls.component.html',
    styleUrl: './player-controls.component.scss',
    imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'player-controls-host',
        '[class.player-controls-host--cursor-hidden]': 'hideCursor()',
    },
})
export class PlayerControlsComponent implements OnDestroy {
    private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
    private readonly translate = inject(TranslateService);
    readonly controller = input.required<PlayerController>();
    readonly playerSurface = input<HTMLElement | null>(null);
    /**
     * Element put into DOM fullscreen; defaults to `playerSurface`. Hosts
     * that remount their player shell per source (`WebPlayerViewComponent`
     * renders one component per playback application) pass an ancestor that
     * outlives the remount: the Fullscreen API exits the moment its element
     * leaves the document, so a shell-owned fullscreen would end with every
     * episode, channel, or alternative-source switch.
     */
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly showControls = input(true);
    readonly shortcutsEnabled = input(true);
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly menus = new ControlsMenuState();
    readonly feedback = new ControlsFeedback();
    readonly anyMenuOpen = this.menus.anyOpen;
    private readonly shortcuts = new ControlsShortcuts();
    private readonly visibility = new ControlsVisibility(() => this.canHide());
    private readonly fullscreen = new ControlsFullscreen(
        () => this.fullscreenTarget() ?? this.playerSurface(),
        () => this.reveal()
    );
    private readonly volume = new ControlsVolume({
        apply: (value) => this.controller().commands.setVolume(value),
        flash: (icon, label) => this.feedback.flash(icon, label),
        mutedLabel: () => this.translate.instant('EMBEDDED_MPV.PLAYER.MUTED'),
        openPopover: () => this.menus.open('volume'),
        closePopover: () => this.menus.close('volume'),
    });
    private readonly surface = new ControlsSurface(
        {
            reveal: () => this.reveal(),
            toggleFullscreen: () => void this.toggleFullscreen(),
            closePopovers: () => this.closePopovers(),
            togglePlay: () => this.togglePlay(),
            canTogglePlay: () => this.canTogglePlay(),
            isMenuOpen: () => this.menus.anyOpen(),
            controlsVisible: () => this.controlsAreVisible(),
            hideControls: () => this.visibility.hide(),
        },
        this.host
    );
    readonly subtitleSettings = new ControlsSubtitleSettings({
        controller: () => this.controller(),
        revealSticky: () => this.reveal({ scheduleHide: false }),
    });
    readonly menuSelection = new ControlsMenuSelection({
        commands: () => this.controller().commands,
        menus: this.menus,
        visibility: this.visibility,
        revealSticky: () => this.reveal({ scheduleHide: false }),
    });
    readonly volumeInteractions = new ControlsVolumeInteractions({
        volume: this.volume,
        menus: this.menus,
        wasTouchInteraction: (event) => this.surface.wasTouchInteraction(event),
        wasPointerFocusRelease: () => this.surface.wasPointerFocusRelease(),
        canAdjustVolume: () => this.capabilities().volume,
        reveal: (options) => this.reveal(options),
    });
    readonly chrome = new ControlsChromeInteractions({
        surface: this.surface,
        visibility: this.visibility,
        reveal: (options) => this.reveal(options),
    });
    readonly streamStats = new ControlsStreamStats(
        () => this.controller().streamStats
    );

    readonly state = computed(() => this.controller().state());
    readonly capabilities = computed(() => this.controller().capabilities());
    private readonly controllerVolume = computed(() => this.state().volume);
    private readonly timeline = new ControlsTimeline(this.state);
    readonly scrubPosition = this.timeline.scrubPosition;
    readonly timelineDuration = this.timeline.duration;
    readonly timelineValue = this.timeline.value;
    readonly timelineProgress = this.timeline.progress;

    readonly displayVolume = this.volume.value;
    readonly isFullscreen = this.fullscreen.isFullscreen;

    // The page around the player already names the content; the overlay only
    // fills that gap in fullscreen, where no other chrome is visible.
    readonly fullscreenMediaTitle = computed<PlayerMediaTitle | null>(() => {
        if (!this.showControls() || !this.isFullscreen()) {
            return null;
        }
        const mediaTitle = this.mediaTitle();
        return mediaTitle?.primary?.trim() ? mediaTitle : null;
    });

    /**
     * The top scrim is shared by every piece of top chrome (the fullscreen
     * media title and the corner buttons): rendering one per consumer would
     * stack two gradients and darken the overlap twice.
     */
    readonly showTopScrim = computed(
        () =>
            this.showControls() &&
            (this.capabilities().streamStats ||
                this.fullscreenMediaTitle() !== null)
    );

    private readonly vm = createControlsViewModel({
        state: this.state,
        capabilities: this.capabilities,
        volume: this.volume.value,
        isFullscreen: this.isFullscreen,
        canFullscreenNative: () => this.fullscreen.canFullscreen(),
        showControls: this.showControls,
        autoHideVisible: this.visibility.visible,
        anyMenuOpen: this.menus.anyOpen,
    });

    readonly isLoading = this.vm.isLoading;
    readonly isPaused = this.vm.isPaused;
    readonly isPlaying = this.vm.isPlaying;
    readonly canTogglePlay = this.vm.canTogglePlay;
    readonly hasAudioTracks = this.vm.hasAudioTracks;
    readonly hasSubtitleTracks = this.vm.hasSubtitleTracks;
    readonly hasQualityLevels = this.vm.hasQualityLevels;
    readonly canRecord = this.vm.canRecord;
    readonly isRecording = this.vm.isRecording;
    readonly recordingStatusText = this.vm.recordingStatusText;
    readonly volumeIcon = this.vm.volumeIcon;
    readonly canFullscreen = this.vm.canFullscreen;
    readonly volumePercent = computed(() =>
        Math.round(this.displayVolume() * 100)
    );
    readonly controlsAreVisible = this.vm.controlsAreVisible;
    readonly hideCursor = this.vm.hideCursor;
    constructor() {
        this.shortcuts.attach({
            isAvailable: () => this.shortcutsEnabled() && this.showControls(),
            hostElement: () => this.host,
            canTogglePaused: () => this.canTogglePlay(),
            canSeek: () => this.capabilities().seek && this.state().canSeek,
            canAdjustVolume: () => this.capabilities().volume,
            canToggleFullscreen: () => this.canFullscreen(),
            onEscape: () => this.closePopovers(),
            togglePaused: () => this.togglePlay(),
            toggleFullscreen: () => void this.toggleFullscreen(),
            seekBy: (delta) => this.seekBy(delta),
            adjustVolume: (delta) => this.volumeInteractions.adjust(delta),
            toggleMute: () => this.volumeInteractions.toggleMute(),
        });
        effect((onCleanup) => {
            const playerSurface = this.playerSurface();
            const surface = this.showControls() ? playerSurface : null;
            // A replaced fullscreen owner re-syncs the state as well.
            void this.fullscreenTarget();
            this.fullscreen.sync();
            onCleanup(this.surface.attachSurface(surface));
        });
        effect(() => {
            const controller = this.controller();
            if (
                !this.volume.beginCapabilityEpoch(
                    controller,
                    this.capabilities().volume
                )
            ) {
                return;
            }
            const volume = this.controllerVolume();
            untracked(() =>
                this.volume.initializeController(controller, volume)
            );
        });
        effect(() => {
            const controller = this.controller();
            const volume = this.controllerVolume();
            untracked(() =>
                this.volume.reconcileController(controller, volume)
            );
        });
        effect((onCleanup) => {
            // Every close path (toggle, Escape, capability loss, teardown)
            // runs through the signal, so the sampler can never outlive the
            // panel it feeds.
            if (!this.menus.statsOpen()) {
                return;
            }
            untracked(() => this.streamStats.start());
            onCleanup(() => this.streamStats.stop());
        });
        effect((onCleanup) => {
            const surface = this.playerSurface();
            if (!surface || !this.hideCursor()) {
                return;
            }
            const previousCursor = surface.style.cursor;
            surface.style.cursor = 'none';
            onCleanup(() => {
                if (surface.style.cursor === 'none') {
                    surface.style.cursor = previousCursor;
                }
            });
        });
        effect(() => {
            const state = this.state();
            const showControls = this.showControls();
            const capabilities = this.capabilities();
            untracked(() => {
                if (!capabilities.seek || !state.canSeek) {
                    this.scrubPosition.set(null);
                }
                this.menus.reconcileControllerAvailability(
                    showControls,
                    capabilities,
                    state
                );
                this.visibility.scheduleHide();
                this.feedback.flashRecordingState(state.recording, {
                    active: this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING'
                    ),
                    inactive: this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING_SAVED'
                    ),
                });
            });
        });
    }
    ngOnDestroy(): void {
        this.shortcuts.detach();
        this.feedback.dispose();
        this.visibility.dispose();
        this.fullscreen.dispose();
        this.volume.dispose();
        this.surface.dispose();
        this.streamStats.dispose();
    }
    formatTime = formatTime;
    speedLabel = speedLabel;
    subtitleDelayLabel = subtitleDelayLabel;
    readonly subtitleSizePresets = SUBTITLE_SIZE_PRESETS;
    readonly subtitleColorPresets = SUBTITLE_COLOR_PRESETS;
    readonly subtitleDelayStep = SUBTITLE_DELAY_STEP_SECONDS;
    togglePlay(): void {
        this.reveal();
        if (!this.canTogglePlay()) {
            return;
        }
        this.controller().commands.togglePlay();
    }
    seekBy(deltaSeconds: number): void {
        this.reveal();
        if (!this.capabilities().seek || !this.state().canSeek) {
            return;
        }
        this.controller().commands.seekBy(deltaSeconds);
        this.feedback.flash(
            deltaSeconds >= 0 ? 'forward_10' : 'replay_10',
            `${deltaSeconds >= 0 ? '+' : ''}${Math.round(deltaSeconds)}s`
        );
    }
    onTimelineInput(event: Event): void {
        this.reveal();
        this.scrubPosition.set(this.timeline.readEventValue(event));
    }
    onTimelineCommit(event: Event): void {
        this.reveal();
        const target = this.timeline.readEventValue(event);
        this.scrubPosition.set(null);
        if (
            target === null ||
            !this.capabilities().seek ||
            !this.state().canSeek
        ) {
            return;
        }
        this.controller().commands.seekTo(target);
    }
    requestPreviousEpisode(): void {
        this.reveal();
        if (!this.state().canPreviousEpisode) {
            return;
        }
        this.previousEpisodeRequested.emit();
    }
    requestNextEpisode(): void {
        this.reveal();
        if (!this.state().canNextEpisode) {
            return;
        }
        this.nextEpisodeRequested.emit();
    }
    toggleMenu(menu: ControlsMenu): void {
        this.menus.toggle(menu);
        this.reveal();
    }

    loadExternalSubtitle(): void {
        if (!this.capabilities().externalSubtitles) {
            return;
        }
        this.menuSelection.externalSubtitle();
    }
    toggleRecording(): void {
        if (!this.canRecord()) {
            return;
        }
        this.reveal({ scheduleHide: false });
        this.controller().commands.toggleRecording();
    }

    togglePictureInPicture(): void {
        this.reveal();
        const state = this.state();
        if (this.capabilities().pictureInPicture && state.canPictureInPicture) {
            this.controller().commands.togglePictureInPicture();
        }
    }
    async toggleFullscreen(): Promise<void> {
        this.reveal();
        if (!this.canFullscreen()) {
            return;
        }
        await this.fullscreen.toggle();
    }
    private closePopovers(): void {
        if (!this.menus.anyOpen()) {
            return;
        }
        this.menus.closeAll();
        this.visibility.scheduleHide();
    }

    reveal(options: { scheduleHide?: boolean } = {}): void {
        this.shortcuts.activate();
        this.visibility.reveal(options);
    }

    private canHide(): boolean {
        return (
            this.isPlaying() &&
            !this.chrome.engaged &&
            !this.menus.anyOpen() &&
            !this.state().statusMessage
        );
    }
}

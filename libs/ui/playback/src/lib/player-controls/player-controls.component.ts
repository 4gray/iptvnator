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
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ControlsFeedback } from './controls-feedback';
import { ControlsFullscreen } from './controls-fullscreen';
import { ControlsMenuSelection } from './controls-menu-selection';
import { ControlsMenuState } from './controls-menu-state';
import { ControlsShortcuts } from './controls-shortcuts';
import { ControlsSurface } from './controls-surface';
import { ControlsVisibility } from './controls-visibility';
import { createControlsViewModel } from './controls-view-model';
import { ControlsVolume } from './controls-volume';
import { formatTime, speedLabel } from './controls-format.utils';
import type { PlayerController } from './player-controls.model';

@Component({
    selector: 'app-player-controls',
    templateUrl: './player-controls.component.html',
    styleUrl: './player-controls.component.scss',
    imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'player-controls-host' },
})
export class PlayerControlsComponent implements OnDestroy {
    private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
    private readonly translate = inject(TranslateService);
    readonly controller = input.required<PlayerController>();
    readonly playerSurface = input<HTMLElement | null>(null);
    readonly showControls = input(true);
    readonly shortcutsEnabled = input(true);
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly barHovered = signal(false);
    private readonly barFocused = signal(false);
    readonly menus = new ControlsMenuState();
    readonly feedback = new ControlsFeedback();
    readonly anyMenuOpen = this.menus.anyOpen;
    private readonly shortcuts = new ControlsShortcuts();
    private readonly visibility = new ControlsVisibility(() => this.canHide());
    private readonly fullscreen = new ControlsFullscreen(
        () => this.playerSurface(),
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
        },
        this.host
    );
    readonly menuSelection = new ControlsMenuSelection({
        commands: () => this.controller().commands,
        menus: this.menus,
        visibility: this.visibility,
        revealSticky: () => this.reveal({ scheduleHide: false }),
    });

    readonly state = computed(() => this.controller().state());
    readonly capabilities = computed(() => this.controller().capabilities());
    private readonly controllerVolume = computed(() => this.state().volume);
    readonly scrubPosition = signal<number | null>(null);
    readonly timelineDuration = computed(() => {
        const duration = this.state().durationSeconds;
        return typeof duration === 'number' && Number.isFinite(duration)
            ? Math.max(0, duration)
            : 0;
    });
    readonly timelineValue = computed(
        () =>
            this.normalizeTimelineValue(
                this.scrubPosition() ?? this.state().positionSeconds
            ) ?? 0
    );
    readonly timelineProgress = computed(() => {
        const duration = this.timelineDuration();
        return this.state().canSeek && duration > 0
            ? (this.timelineValue() / duration) * 100
            : 0;
    });

    readonly displayVolume = this.volume.value;
    readonly isFullscreen = this.fullscreen.isFullscreen;

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
            canTogglePaused: () => this.canTogglePlay(),
            canSeek: () => this.capabilities().seek && this.state().canSeek,
            canAdjustVolume: () => this.capabilities().volume,
            canToggleFullscreen: () => this.canFullscreen(),
            onEscape: () => this.closePopovers(),
            togglePaused: () => this.togglePlay(),
            toggleFullscreen: () => void this.toggleFullscreen(),
            seekBy: (delta) => this.seekBy(delta),
            adjustVolume: (delta) => this.adjustVolume(delta),
            toggleMute: () => this.toggleMute(),
        });
        effect((onCleanup) => {
            const surface = this.showControls() ? this.playerSurface() : null;
            onCleanup(this.surface.attachSurface(surface));
        });
        effect(() => {
            void this.controller(); // Track equal-volume controller swaps.
            const volume = this.controllerVolume();
            untracked(() => this.volume.reconcile(volume));
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
                this.feedback.flashRecordingTransition(state.recording.active, {
                    active: this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING'
                    ),
                    inactive:
                        state.recording.message ||
                        this.translate.instant(
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
    }
    formatTime = formatTime;
    speedLabel = speedLabel;
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
        this.scrubPosition.set(this.readTimelineValue(event));
    }
    onTimelineCommit(event: Event): void {
        this.reveal();
        const target = this.readTimelineValue(event);
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
    onVolumeInput(event: Event): void {
        this.volume.set(Number((event.target as HTMLInputElement).value));
        this.reveal({ scheduleHide: false });
    }

    onVolumeWheel(event: WheelEvent): void {
        event.preventDefault();
        this.adjustVolume(event.deltaY > 0 ? -0.05 : 0.05);
    }

    onVolumeHoverEnter(): void {
        this.volume.hoverEnter();
    }

    onVolumeHoverLeave(): void {
        this.volume.hoverLeave();
    }

    toggleMute(): void {
        if (!this.capabilities().volume) {
            return;
        }
        this.volume.toggleMute();
        this.reveal();
    }

    toggleMenu(menu: 'audio' | 'subtitle' | 'speed' | 'aspect'): void {
        this.menus.toggle(menu);
        this.reveal();
    }

    toggleRecording(): void {
        if (!this.canRecord()) {
            return;
        }
        this.reveal({ scheduleHide: false });
        this.controller().commands.toggleRecording();
    }

    async toggleFullscreen(): Promise<void> {
        this.reveal();
        if (!this.canFullscreen()) {
            return;
        }
        await this.fullscreen.toggle();
    }

    private adjustVolume(delta: number): void {
        if (!this.capabilities().volume) {
            return;
        }
        this.volume.adjust(delta);
        this.reveal();
    }

    private readTimelineValue(event: Event): number | null {
        return this.normalizeTimelineValue(
            Number((event.target as HTMLInputElement).value)
        );
    }

    private normalizeTimelineValue(value: number): number | null {
        if (!Number.isFinite(value)) {
            return null;
        }

        const duration = this.state().durationSeconds;
        const upperBound =
            typeof duration === 'number' && Number.isFinite(duration)
                ? Math.max(0, duration)
                : Number.POSITIVE_INFINITY;
        return Math.min(Math.max(0, value), upperBound);
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

    onBarPointerEnter(): void {
        this.barHovered.set(true);
        this.reveal({ scheduleHide: false });
    }

    onBarPointerLeave(): void {
        this.barHovered.set(false);
        this.visibility.scheduleHide();
    }

    onBarFocusIn(): void {
        this.barFocused.set(true);
        this.reveal({ scheduleHide: false });
    }

    onBarFocusOut(event: FocusEvent): void {
        const bar = event.currentTarget as HTMLElement | null;
        const next = event.relatedTarget;
        if (bar && next instanceof Node && bar.contains(next)) {
            return;
        }
        this.barFocused.set(false);
        this.visibility.scheduleHide();
    }

    private canHide(): boolean {
        return (
            this.isPlaying() &&
            !this.barHovered() &&
            !this.barFocused() &&
            !this.menus.anyOpen() &&
            !this.state().statusMessage
        );
    }
}

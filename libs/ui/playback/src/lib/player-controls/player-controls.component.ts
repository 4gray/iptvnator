import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    computed,
    effect,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
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

/**
 * Default, engine-agnostic player controls. Binds purely to a
 * {@link PlayerController} (capabilities + reactive state + commands) and owns
 * only transient presentation state (menus, feedback, auto-hide, fullscreen,
 * keyboard shortcuts). The same component drives embedded MPV and web players.
 */
@Component({
    selector: 'app-player-controls',
    templateUrl: './player-controls.component.html',
    styleUrl: './player-controls.component.scss',
    imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'player-controls-host' },
})
export class PlayerControlsComponent implements OnDestroy {
    readonly controller = input.required<PlayerController>();
    readonly playerSurface = input<HTMLElement | null>(null);
    readonly showControls = input(true);
    readonly shortcutsEnabled = input(true);

    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    /** True while the pointer rests over the controls bar (pauses auto-hide). */
    readonly barHovered = signal(false);

    readonly menus = new ControlsMenuState();
    readonly feedback = new ControlsFeedback();
    /** Exposed so a host (e.g. the MPV compositor) can react to open menus. */
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
        openPopover: () => this.menus.open('volume'),
        closePopover: () => this.menus.close('volume'),
    });
    private readonly surface = new ControlsSurface({
        reveal: () => this.reveal(),
        toggleFullscreen: () => void this.toggleFullscreen(),
        closePopovers: () => this.closePopovers(),
        togglePlay: () => this.togglePlay(),
        isMenuOpen: () => this.menus.anyOpen(),
    });
    /** Exposed for template menu-item bindings (track/speed/aspect select). */
    readonly menuSelection = new ControlsMenuSelection({
        commands: () => this.controller().commands,
        menus: this.menus,
        visibility: this.visibility,
        revealSticky: () => this.reveal({ scheduleHide: false }),
    });

    readonly state = computed(() => this.controller().state());
    readonly capabilities = computed(() => this.controller().capabilities());

    get displayVolume() {
        return this.volume.value;
    }
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
    readonly hasAudioTracks = this.vm.hasAudioTracks;
    readonly hasSubtitleTracks = this.vm.hasSubtitleTracks;
    readonly canRecord = this.vm.canRecord;
    readonly isRecording = this.vm.isRecording;
    readonly recordingStatusText = this.vm.recordingStatusText;
    readonly volumeIcon = this.vm.volumeIcon;
    readonly canFullscreen = this.vm.canFullscreen;
    /** Integer volume percent, passed to the localized volume label. */
    readonly volumePercent = computed(() =>
        Math.round(this.volume.value() * 100)
    );
    readonly controlsAreVisible = this.vm.controlsAreVisible;
    readonly hideCursor = this.vm.hideCursor;

    constructor() {
        this.shortcuts.attach({
            isAvailable: () => this.shortcutsEnabled() && this.showControls(),
            onEscape: () => this.closePopovers(),
            togglePaused: () => this.togglePlay(),
            toggleFullscreen: () => void this.toggleFullscreen(),
            seekBy: (delta) => this.seekBy(delta),
            adjustVolume: (delta) => this.adjustVolume(delta),
            toggleMute: () => this.toggleMute(),
        });

        // Bind reveal/auto-hide to the interaction surface whenever it changes.
        effect((onCleanup) => {
            onCleanup(this.surface.attachSurface(this.playerSurface()));
        });

        // Reconcile optimistic volume + reschedule auto-hide when state moves.
        effect(() => {
            const state = this.state();
            untracked(() => {
                this.volume.reconcile(state.volume);
                this.visibility.scheduleHide();
            });
        });

        // Flash transient feedback on recording start/stop transitions.
        effect(() => {
            const active = this.state().recording.active;
            untracked(() => this.feedback.flashRecordingTransition(active));
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
        this.controller().commands.togglePlay();
    }

    seekBy(deltaSeconds: number): void {
        this.reveal();
        if (!this.state().canSeek) {
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
        const target = Number((event.target as HTMLInputElement).value);
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
        this.volume.adjust(delta);
        this.reveal();
    }

    private closePopovers(): void {
        if (!this.menus.anyOpen()) {
            return;
        }
        this.menus.closeAll();
        this.visibility.scheduleHide();
    }

    /** Reveal the controls (and reschedule auto-hide unless suppressed). */
    reveal(options: { scheduleHide?: boolean } = {}): void {
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

    private canHide(): boolean {
        return (
            this.isPlaying() &&
            !this.barHovered() &&
            !this.menus.anyOpen() &&
            !this.state().statusMessage
        );
    }
}

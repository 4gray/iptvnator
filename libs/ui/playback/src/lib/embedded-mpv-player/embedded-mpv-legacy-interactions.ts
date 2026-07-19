import type { WritableSignal } from '@angular/core';
import type { EmbeddedMpvMenuState } from './embedded-mpv-ui-state';

const HIDE_CONTROLS_DELAY_MS = 2500;
const VOLUME_POPOVER_CLOSE_DELAY_MS = 220;
const VIEWPORT_CLICK_PAUSE_DELAY_MS = 250;

export interface EmbeddedMpvLegacyInteractionsDeps {
    readonly isAvailable: () => boolean;
    readonly playerRoot: () => HTMLElement | null;
    readonly menus: EmbeddedMpvMenuState;
    readonly controlsVisible: WritableSignal<boolean>;
    readonly isLoading: () => boolean;
    readonly isErrored: () => boolean;
    readonly isStalled: () => boolean;
    readonly isPlaying: () => boolean;
    readonly statusLabel: () => string;
    readonly togglePaused: () => void | Promise<void>;
    readonly toggleFullscreen: () => void | Promise<void>;
}

export class EmbeddedMpvLegacyInteractions {
    private controlsHideTimer: number | null = null;
    private volumeCloseTimer: number | null = null;
    private viewportClickTimer: number | null = null;
    private attached = false;

    private readonly onDocumentPointerDown = (event: PointerEvent) => {
        if (!this.deps.isAvailable()) {
            return;
        }
        const playerRoot = this.deps.playerRoot();
        if (!playerRoot || event.composedPath().includes(playerRoot)) {
            return;
        }
        this.closePopovers();
    };

    private readonly onDocumentPointerMove = (event: PointerEvent) => {
        if (!this.deps.isAvailable()) {
            return;
        }
        const playerRoot = this.deps.playerRoot();
        if (
            playerRoot &&
            !event.composedPath().includes(playerRoot) &&
            this.isPointerInsidePlayer(event)
        ) {
            this.revealControls();
        }
    };

    constructor(private readonly deps: EmbeddedMpvLegacyInteractionsDeps) {}

    attach(): void {
        if (this.attached || typeof document === 'undefined') {
            return;
        }
        document.addEventListener('pointerdown', this.onDocumentPointerDown);
        document.addEventListener('pointermove', this.onDocumentPointerMove, {
            passive: true,
        });
        this.attached = true;
    }

    dispose(): void {
        if (this.attached && typeof document !== 'undefined') {
            document.removeEventListener(
                'pointerdown',
                this.onDocumentPointerDown
            );
            document.removeEventListener(
                'pointermove',
                this.onDocumentPointerMove
            );
        }
        this.attached = false;
        this.clearControlsHideTimer();
        this.clearVolumeCloseTimer();
        this.clearViewportClickTimer();
    }

    isAvailable(): boolean {
        return this.deps.isAvailable();
    }

    handleEngineTransition(isFrameCopyEngine: boolean): void {
        if (!isFrameCopyEngine) {
            return;
        }
        this.clearControlsHideTimer();
        this.clearVolumeCloseTimer();
        this.clearViewportClickTimer();
        this.deps.menus.closeAll();
    }

    onPlayerInteraction(): void {
        if (!this.deps.isAvailable()) {
            return;
        }
        this.revealControls();
    }

    onViewportClick(event: MouseEvent): void {
        if (!this.deps.isAvailable()) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, [role="slider"]')) {
            return;
        }
        if (this.deps.menus.anyOpen()) {
            this.deps.menus.closeAll();
            return;
        }
        if (
            this.deps.isLoading() ||
            this.deps.isErrored() ||
            this.deps.isStalled()
        ) {
            return;
        }
        // Delay the single-click transport toggle so a double-click can
        // cancel it and claim the interaction for fullscreen instead.
        this.clearViewportClickTimer();
        this.viewportClickTimer = window.setTimeout(() => {
            this.viewportClickTimer = null;
            void this.deps.togglePaused();
        }, VIEWPORT_CLICK_PAUSE_DELAY_MS);
    }

    onPlayerDblClick(event: MouseEvent): void {
        if (!this.deps.isAvailable()) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, [role="slider"]')) {
            return;
        }
        this.clearViewportClickTimer();
        void this.deps.toggleFullscreen();
    }

    onVolumeHoverEnter(): void {
        if (!this.deps.isAvailable()) {
            return;
        }
        this.clearVolumeCloseTimer();
        this.deps.menus.open('volume');
    }

    onVolumeHoverLeave(): void {
        if (!this.deps.isAvailable()) {
            return;
        }
        this.clearVolumeCloseTimer();
        this.volumeCloseTimer = window.setTimeout(() => {
            this.deps.menus.close('volume');
            this.volumeCloseTimer = null;
        }, VOLUME_POPOVER_CLOSE_DELAY_MS);
    }

    closePopovers(): void {
        if (!this.deps.isAvailable() || !this.deps.menus.anyOpen()) {
            return;
        }
        // Menus live inside the fixed-height dock strip, so closing them
        // needs no bounds resync — the native MPV view never moved.
        this.deps.menus.closeAll();
        this.scheduleControlsHide();
    }

    revealControls(scheduleHide = true): void {
        if (!this.deps.isAvailable()) {
            this.clearControlsHideTimer();
            return;
        }
        this.deps.controlsVisible.set(true);
        if (scheduleHide) {
            this.clearControlsHideTimer();
            this.scheduleControlsHide();
        }
    }

    scheduleControlsHide(): void {
        if (!this.deps.isAvailable()) {
            this.clearControlsHideTimer();
            return;
        }
        if (
            !this.deps.isPlaying() ||
            this.deps.menus.anyOpen() ||
            Boolean(this.deps.statusLabel())
        ) {
            this.clearControlsHideTimer();
            return;
        }
        if (!this.deps.controlsVisible() || this.controlsHideTimer !== null) {
            return;
        }
        this.controlsHideTimer = window.setTimeout(() => {
            if (
                this.deps.isPlaying() &&
                !this.deps.menus.anyOpen() &&
                !this.deps.statusLabel()
            ) {
                this.deps.controlsVisible.set(false);
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

    private clearVolumeCloseTimer(): void {
        if (this.volumeCloseTimer === null) {
            return;
        }
        window.clearTimeout(this.volumeCloseTimer);
        this.volumeCloseTimer = null;
    }

    private clearViewportClickTimer(): void {
        if (this.viewportClickTimer === null) {
            return;
        }
        window.clearTimeout(this.viewportClickTimer);
        this.viewportClickTimer = null;
    }

    private isPointerInsidePlayer(event: PointerEvent): boolean {
        const playerRoot = this.deps.playerRoot();
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

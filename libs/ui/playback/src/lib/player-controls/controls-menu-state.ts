import { computed, signal } from '@angular/core';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

const CONTROL_MENUS = [
    'volume',
    'audio',
    'subtitle',
    'speed',
    'aspect',
] as const;

export type ControlsMenu = (typeof CONTROL_MENUS)[number];
export type ControlsMenuAvailability = Readonly<Record<ControlsMenu, boolean>>;

function getControlsMenuAvailability(
    showControls: boolean,
    capabilities: PlayerControlsCapabilities,
    state: PlayerControlsState
): ControlsMenuAvailability {
    return {
        volume: showControls && capabilities.volume,
        audio:
            showControls &&
            capabilities.audioTracks &&
            state.audioTracks.length > 1,
        subtitle:
            showControls &&
            capabilities.subtitles &&
            state.subtitleTracks.length > 0,
        speed: showControls && capabilities.playbackSpeed,
        aspect: showControls && capabilities.aspectRatio,
    };
}

/**
 * Tracks which menu/popover is currently open and exposes individual signals
 * the template binds to. Only one menu can be open at a time.
 */
export class ControlsMenuState {
    readonly volumeOpen = signal(false);
    readonly audioOpen = signal(false);
    readonly subtitleOpen = signal(false);
    readonly speedOpen = signal(false);
    readonly aspectOpen = signal(false);

    readonly anyOpen = computed(
        () =>
            this.volumeOpen() ||
            this.audioOpen() ||
            this.subtitleOpen() ||
            this.speedOpen() ||
            this.aspectOpen()
    );

    toggle(menu: ControlsMenu): void {
        const target = this.signalFor(menu);
        const next = !target();
        this.closeAll();
        target.set(next);
    }

    open(menu: ControlsMenu): void {
        if (this.signalFor(menu)()) {
            return;
        }
        this.closeAll();
        this.signalFor(menu).set(true);
    }

    close(menu: ControlsMenu): void {
        this.signalFor(menu).set(false);
    }

    closeAll(): void {
        this.volumeOpen.set(false);
        this.audioOpen.set(false);
        this.subtitleOpen.set(false);
        this.speedOpen.set(false);
        this.aspectOpen.set(false);
    }

    reconcile(availability: ControlsMenuAvailability): boolean {
        let changed = false;
        for (const menu of CONTROL_MENUS) {
            const open = this.signalFor(menu);
            if (open() && !availability[menu]) {
                open.set(false);
                changed = true;
            }
        }
        return changed;
    }

    reconcileControllerAvailability(
        showControls: boolean,
        capabilities: PlayerControlsCapabilities,
        state: PlayerControlsState
    ): boolean {
        return this.reconcile(
            getControlsMenuAvailability(showControls, capabilities, state)
        );
    }

    private signalFor(menu: ControlsMenu) {
        switch (menu) {
            case 'volume':
                return this.volumeOpen;
            case 'audio':
                return this.audioOpen;
            case 'subtitle':
                return this.subtitleOpen;
            case 'speed':
                return this.speedOpen;
            case 'aspect':
                return this.aspectOpen;
        }
    }
}

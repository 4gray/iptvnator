import type { ControlsMenuState } from './controls-menu-state';
import type { ControlsVisibility } from './controls-visibility';
import type { PlayerControlsCommands } from './player-controls.model';

type MenuKey = 'audio' | 'subtitle' | 'speed' | 'aspect';

export interface MenuSelectionDeps {
    commands: () => PlayerControlsCommands;
    menus: ControlsMenuState;
    visibility: ControlsVisibility;
    /** Reveal without rescheduling the auto-hide (kept open while choosing). */
    revealSticky: () => void;
}

/**
 * Owns track/speed/aspect menu selection: reveal-without-hide, run the command,
 * close the menu, then reschedule the auto-hide. Keeps the component lean while
 * the template still binds to thin delegating methods.
 */
export class ControlsMenuSelection {
    constructor(private readonly deps: MenuSelectionDeps) {}

    toggle(menu: MenuKey): void {
        this.deps.menus.toggle(menu);
    }

    audioTrack(trackId: number): void {
        this.apply('audio', (c) => c.setAudioTrack(trackId));
    }

    subtitleTrack(trackId: number): void {
        this.apply('subtitle', (c) => c.setSubtitleTrack(trackId));
    }

    speed(value: number): void {
        this.apply('speed', (c) => c.setPlaybackSpeed(value));
    }

    aspect(value: string): void {
        this.apply('aspect', (c) => c.setAspectRatio(value));
    }

    private apply(menu: MenuKey, run: (c: PlayerControlsCommands) => void): void {
        this.deps.revealSticky();
        run(this.deps.commands());
        this.deps.menus.close(menu);
        this.deps.visibility.scheduleHide();
    }
}

import type { PlayerControlsCommands } from './player-controls.model';

export interface MenuSelectionDeps {
    commands: () => PlayerControlsCommands;
    /** Reveal without rescheduling the auto-hide (the panel stays open). */
    revealSticky: () => void;
}

/**
 * Owns track/quality/speed/aspect selection from the settings panel: reveal
 * without hiding, then run the command. The panel deliberately stays open —
 * a choice applies immediately and is judged against the running video, so
 * closing it on every click would cost a reopen per comparison.
 */
export class ControlsMenuSelection {
    constructor(private readonly deps: MenuSelectionDeps) {}

    audioTrack(trackId: number): void {
        this.apply((c) => c.setAudioTrack(trackId));
    }

    subtitleTrack(trackId: number): void {
        this.apply((c) => c.setSubtitleTrack(trackId));
    }

    /** Opens the engine's subtitle file picker. */
    externalSubtitle(): void {
        this.apply((c) => c.addExternalSubtitleFile());
    }

    qualityLevel(levelId: number): void {
        this.apply((c) => c.setQualityLevel(levelId));
    }

    speed(value: number): void {
        this.apply((c) => c.setPlaybackSpeed(value));
    }

    aspect(value: string): void {
        this.apply((c) => c.setAspectRatio(value));
    }

    private apply(run: (c: PlayerControlsCommands) => void): void {
        this.deps.revealSticky();
        run(this.deps.commands());
    }
}

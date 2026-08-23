import type {
    PlayerController,
    PlayerSubtitleStyle,
} from './player-controls.model';
import { clampSubtitleDelay } from './subtitle-style';

export interface ControlsSubtitleSettingsDeps {
    controller: () => PlayerController;
    /** Reveal without rescheduling auto-hide (menu stays open while tuning). */
    revealSticky: () => void;
}

/**
 * Owns the delay/size/color interactions of the subtitle popover: guard on the
 * capability, keep the controls revealed, clamp, and forward the command. The
 * popover intentionally stays open — these settings are tuned iteratively
 * against the running video.
 */
export class ControlsSubtitleSettings {
    constructor(private readonly deps: ControlsSubtitleSettingsDeps) {}

    adjustDelay(deltaSeconds: number): void {
        const controller = this.deps.controller();
        this.applyDelay(
            controller.state().subtitleDelaySeconds + deltaSeconds
        );
    }

    resetDelay(): void {
        this.applyDelay(0);
    }

    setSize(sizePercent: number): void {
        const controller = this.deps.controller();
        this.applyStyle({ ...controller.state().subtitleStyle, sizePercent });
    }

    setColor(color: string | null): void {
        const controller = this.deps.controller();
        this.applyStyle({ ...controller.state().subtitleStyle, color });
    }

    private applyDelay(seconds: number): void {
        const controller = this.deps.controller();
        if (!controller.capabilities().subtitleDelay) {
            return;
        }
        this.deps.revealSticky();
        controller.commands.setSubtitleDelay(clampSubtitleDelay(seconds));
    }

    private applyStyle(style: PlayerSubtitleStyle): void {
        const controller = this.deps.controller();
        if (!controller.capabilities().subtitleStyle) {
            return;
        }
        this.deps.revealSticky();
        controller.commands.setSubtitleStyle(style);
    }
}

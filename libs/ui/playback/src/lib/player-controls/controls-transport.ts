import type { ControlsFeedback } from './controls-feedback';
import type { PlayerController } from './player-controls.model';

export interface ControlsTransportDeps {
    readonly controller: () => PlayerController;
    readonly feedback: ControlsFeedback;
    readonly reveal: () => void;
    /** Feedback label after a jump to live, e.g. the translated "LIVE". */
    readonly liveLabel: () => string;
}

/**
 * Transport-row actions besides play/pause: the ±10 s skip and the jump to
 * the live edge. Each reveals the controls, honours the engine's capability
 * (and, for seeking, state) gates, and flashes the centre feedback. The jump
 * flashes even when the engine has nothing to skip: "you are live" either
 * way.
 */
export class ControlsTransport {
    constructor(private readonly deps: ControlsTransportDeps) {}

    seekBy(deltaSeconds: number): void {
        this.deps.reveal();
        const controller = this.deps.controller();
        if (!controller.capabilities().seek || !controller.state().canSeek) {
            return;
        }
        controller.commands.seekBy(deltaSeconds);
        this.deps.feedback.flash(
            deltaSeconds >= 0 ? 'forward_10' : 'replay_10',
            `${deltaSeconds >= 0 ? '+' : ''}${Math.round(deltaSeconds)}s`
        );
    }

    jumpToLiveEdge(): void {
        this.deps.reveal();
        const controller = this.deps.controller();
        if (!controller.capabilities().liveEdge) {
            return;
        }
        controller.commands.jumpToLiveEdge();
        this.deps.feedback.flash('fast_forward', this.deps.liveLabel());
    }
}

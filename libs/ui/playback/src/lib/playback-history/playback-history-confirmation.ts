import type {
    PlaybackHistoryGate,
    PlaybackHistoryTarget,
} from '@iptvnator/playback/data-access';
import { PlaybackProgressConfirmation } from './playback-progress-confirmation';

export interface PlaybackHistoryConfirmationOptions {
    readonly gate: Pick<PlaybackHistoryGate, 'confirm'>;
    /** What is playing now: its session key and/or stream URLs. */
    readonly target: () => PlaybackHistoryTarget;
    /**
     * Engine/source generation within the same keys (engine switch, live
     * format fallback, reload). A change restarts the position clock but
     * keeps the progress already seen.
     */
    readonly sourceRevision?: () => unknown;
}

/**
 * Confirms a player's current stream to the {@link PlaybackHistoryGate} once
 * it has really played. What is playing is re-read on every report rather
 * than tracked by an effect, so a report of a new stream can never be added
 * to the progress of the one before it.
 */
export class PlaybackHistoryConfirmation {
    private identity: string | null = null;
    private sourceRevision: unknown = null;
    private readonly progress = new PlaybackProgressConfirmation(() =>
        this.options.gate.confirm(this.options.target())
    );

    constructor(private readonly options: PlaybackHistoryConfirmationOptions) {}

    /** @param playing see {@link PlaybackProgressConfirmation.record}. */
    record(position: number, playing?: boolean): void {
        const identity = JSON.stringify(this.options.target());
        const sourceRevision = this.options.sourceRevision?.() ?? null;
        if (identity !== this.identity) {
            this.identity = identity;
            this.sourceRevision = sourceRevision;
            this.progress.reset();
        } else if (sourceRevision !== this.sourceRevision) {
            this.sourceRevision = sourceRevision;
            this.progress.rebase();
        }

        this.progress.record(position, playing);
    }
}

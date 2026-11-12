import { inject, Injectable } from '@angular/core';
import {
    sameXtreamLiveOwner,
    type XtreamLiveOwner,
} from './xtream-external-live-sessions.service';
import { XtreamGuideExternalPlayback } from './xtream-guide-external-playback.service';

type TuneRequest = { generation: number; owner?: XtreamLiveOwner };

/** Retires work when another tune, Stop or a playlist change supersedes it. */
@Injectable()
export class XtreamTuneRequests {
    private readonly external = inject(XtreamGuideExternalPlayback);
    private generation = 0;
    private inlineConfirmation?: () => void;

    begin(): TuneRequest {
        this.invalidate();
        return this.current();
    }

    invalidate(): void {
        this.generation++;
        this.inlineConfirmation = undefined;
    }

    isCurrent(request: TuneRequest): boolean {
        return (
            request.generation === this.generation &&
            sameXtreamLiveOwner(request.owner, this.external.owner())
        );
    }

    confirmInlineWhenReady(
        callback: (() => void) | undefined,
        playing: boolean
    ): void {
        this.inlineConfirmation = playing ? undefined : callback;
        if (playing) callback?.();
    }

    confirmInline(): void {
        const callback = this.inlineConfirmation;
        this.inlineConfirmation = undefined;
        callback?.();
    }

    afterCancellation(
        cancelled: Promise<void>,
        channelId: number,
        retune: () => void,
        onConfirmed?: () => void
    ): void {
        const request = this.current();
        void cancelled.then(() => {
            if (!this.isCurrent(request)) return;
            const playing = this.external.confirmed();
            if (
                playing?.item.xtream_id === channelId &&
                !playing.archive &&
                !this.external.isStopping()
            )
                onConfirmed?.();
            else retune();
        });
    }

    private current(): TuneRequest {
        return { generation: this.generation, owner: this.external.owner() };
    }
}

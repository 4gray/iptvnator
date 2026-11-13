import { inject, Injectable } from '@angular/core';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    sameXtreamLiveOwner,
    type XtreamLiveOwner,
    type XtreamLiveSource,
} from './xtream-external-live-sessions.service';
import type { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import { XtreamGuideExternalPlayback } from './xtream-guide-external-playback.service';
import {
    sameXtreamChannelCopy,
    type XtreamLiveChannelItem,
} from './xtream-live-channel-navigation.service';

type TuneRequest = { generation: number; owner?: XtreamLiveOwner };

interface GuideTuneView {
    usesInlinePlayer(): boolean;
    playingLiveChannel(): XtreamLiveChannelItem | null;
    category(item: XtreamLiveChannelItem): XtreamLiveSource['categoryId'];
    selectInlineCopy(item: XtreamLiveChannelItem): void;
    clearPreview(): void;
    confirmInline(onConfirmed?: () => void): void;
    tune(
        item: XtreamLiveChannelItem,
        channels: readonly XtreamLiveChannelItem[],
        onConfirmed?: () => void
    ): void;
    playArchive(
        program: EpgProgram,
        item: XtreamLiveChannelItem,
        channels: readonly XtreamLiveChannelItem[]
    ): void;
}

/** Retires work when another tune, Stop or a playlist change supersedes it. */
@Injectable()
export class XtreamTuneRequests {
    private readonly external = inject(XtreamGuideExternalPlayback);
    private generation = 0;
    private inlineConfirmation?: () => void;

    bindGuide(source: XtreamEpgGuideSourceService, view: GuideTuneView): void {
        source.bind(
            (item, channels, retry, onConfirmed) => {
                const inline = view.usesInlinePlayer();
                const playing = view.playingLiveChannel();
                const alreadyLive =
                    playing?.xtream_id === item.xtream_id &&
                    (inline || !this.external.isStopping());
                const cancelled =
                    !inline &&
                    alreadyLive &&
                    this.external.cancelPendingSwitch(item);
                if (
                    !inline &&
                    !retry &&
                    this.external.replacePendingCopy(
                        item,
                        () => view.category(item),
                        channels,
                        onConfirmed
                    )
                )
                    return;
                const tune = () => view.tune(item, channels, onConfirmed);
                if (!alreadyLive || (retry && !cancelled)) return tune();

                this.invalidate();
                if (!sameXtreamChannelCopy(playing, item)) {
                    if (inline) view.selectInlineCopy(item);
                    else
                        this.external.replaceConfirmedCopy(
                            item,
                            view.category(item)
                        );
                }
                if (inline) return view.confirmInline(onConfirmed);
                if (onConfirmed) {
                    view.clearPreview();
                    this.external.restoreConfirmedPanel(true);
                }
                if (cancelled)
                    this.afterCancellation(
                        cancelled,
                        item.xtream_id,
                        tune,
                        onConfirmed,
                        retry
                    );
                else onConfirmed?.();
            },
            () =>
                !view.usesInlinePlayer() &&
                this.external.canRetryUnverifiedStream(),
            (watchLive) =>
                watchLive ||
                (!view.usesInlinePlayer() && this.external.isStopping()),
            view.playArchive
        );
    }

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

    dispatchGuard(): () => boolean {
        const request = this.current();
        return () => this.isCurrent(request);
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
        onConfirmed?: () => void,
        retryUnverified = false
    ): void {
        const request = this.current();
        void cancelled.then(() => {
            if (!this.isCurrent(request)) return;
            const playing = this.external.confirmed();
            if (
                playing?.item.xtream_id === channelId &&
                !playing.archive &&
                !this.external.isStopping() &&
                !(retryUnverified && this.external.canRetryUnverifiedStream())
            )
                onConfirmed?.();
            else retune();
        });
    }

    private current(): TuneRequest {
        return { generation: this.generation, owner: this.external.owner() };
    }
}

import { getProgramTimeMs } from '../epg-program.utils';
import { EMPTY, finalize } from 'rxjs';
import {
    EpgItemDialogAction,
    EpgItemDialogData,
} from '../epg-item-description/epg-item-description.component';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import {
    EpgGuideCatchUp,
    EpgGuideChannel,
    EpgGuideSearchHit,
} from './epg-guide-source';

export interface EpgGuideDialogHost {
    /** The rows currently rendered, in display order. */
    rows(): readonly EpgGuideChannel[];
    /** EPG display offset in minutes; search hits carry provider instants. */
    offsetMinutes(): number;
    /** Move the keyboard focus to a row and scroll it into view. */
    focusRow(rowIndex: number): void;
    /** Switch playback to the channel (a no-op when it already plays). */
    activate(channel: EpgGuideChannel): void;
    catchUp(): EpgGuideCatchUp | undefined;
    isChannelVisible?(epgKey: string): boolean;
}

/**
 * Every programme-dialog entry point of the guide: a card's details, a
 * catch-up request and a search hit. Split out of the shell component, which
 * owns rows, focus and playback and supplies them through the host.
 */
export class EpgGuideDialogController {
    private details?: { epgKey: string; owner: AbortController };
    constructor(
        private readonly programmeDialog: EpgProgrammeDialogService,
        private readonly host: EpgGuideDialogHost
    ) {}

    openDetails(
        channel: EpgGuideChannel | undefined,
        item: TimelineRenderBlock | undefined
    ): void {
        if (!channel || !item) {
            return;
        }
        const when = item.block.when;
        this.openForChannel(channel.epgKey, {
            ...item.block.program,
            channelName: channel.name,
            channelLogo: channel.logoUrl,
            primaryAction:
                when === 'now' ? 'live' : item.canCatchUp ? 'timeshift' : null,
            archiveUnavailableNote: when === 'past' && !item.canCatchUp,
        }).subscribe((result: EpgItemDialogAction | undefined) => {
            if (result === 'live') {
                this.host.activate(channel);
            } else if (result === 'timeshift') {
                this.host.catchUp()?.watch(channel, item.block.program);
            }
        });
    }

    watch(channel: EpgGuideChannel, item: TimelineRenderBlock): void {
        this.host.catchUp()?.watch(channel, item.block.program);
    }

    /**
     * Open a search hit. When the host resolved the hit's row, focus and reveal
     * it and label the dialog with that channel; an unresolved hit still opens,
     * just without a channel.
     */
    openSearchResult(hit: EpgGuideSearchHit): void {
        const rows = this.host.rows();
        const rowIndex =
            hit.channelId === null
                ? -1
                : rows.findIndex(
                      (row) =>
                          row.id === hit.channelId &&
                          (hit.channelEpgKey === undefined ||
                              row.epgKey === hit.channelEpgKey)
                  );
        const channel = rowIndex < 0 ? null : rows[rowIndex];
        if (channel) {
            this.host.focusRow(rowIndex);
        }
        this.openForChannel(
            hit.channelEpgKey ?? channel?.epgKey,
            channel
                ? {
                      ...hit.program,
                      channelName: channel.name,
                      channelLogo: channel.logoUrl,
                  }
                : {
                      ...hit.program,
                      channelName: hit.channelName ?? null,
                  }
        ).subscribe();
    }

    checkVisibility(): void {
        if (this.details && !this.host.isChannelVisible?.(this.details.epgKey))
            this.close();
    }

    close(): void {
        this.details?.owner.abort();
        this.details = undefined;
    }

    private openForChannel(
        epgKey: string | null | undefined,
        data: EpgItemDialogData
    ) {
        if (!epgKey || !this.host.isChannelVisible)
            return this.programmeDialog.open(data);
        if (!this.host.isChannelVisible(epgKey)) return EMPTY;
        this.close();
        const details = { epgKey, owner: new AbortController() };
        this.details = details;
        return this.programmeDialog.open(data, details.owner.signal).pipe(
            finalize(() => {
                if (this.details === details) this.details = undefined;
            })
        );
    }

    /**
     * A hit's start as the guide displays it. Results come straight from the
     * host's EPG store, so they carry provider instants and must go through
     * the same display-offset shift as every other time in the guide.
     */
    searchHitStartMs(hit: EpgGuideSearchHit): number {
        return getProgramTimeMs(
            hit.program.start,
            hit.program.startTimestamp,
            this.host.offsetMinutes()
        );
    }
}

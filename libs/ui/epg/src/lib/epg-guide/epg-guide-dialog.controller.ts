import { getProgramTimeMs } from '../epg-program.utils';
import { EpgItemDialogAction } from '../epg-item-description/epg-item-description.component';
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
}

/**
 * Every programme-dialog entry point of the guide: a card's details, a
 * catch-up request and a search hit. Split out of the shell component, which
 * owns rows, focus and playback and supplies them through the host.
 */
export class EpgGuideDialogController {
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
        const catchUp = this.host.catchUp();
        const canWatch =
            catchUp?.canWatch(channel, item.block.program) ?? false;
        this.programmeDialog
            .open({
                ...item.block.program,
                channelName: channel.name,
                channelLogo: channel.logoUrl,
                archiveUrlAvailable: canWatch && !!catchUp?.copyUrl,
                primaryAction:
                    when === 'now'
                        ? 'live'
                        : canWatch
                          ? 'timeshift'
                          : null,
                archiveUnavailableNote: when !== 'now' && !canWatch,
            })
            .subscribe((result: EpgItemDialogAction | undefined) => {
                if (result === 'live') {
                    this.host.activate(channel);
                } else if (result === 'timeshift') {
                    catchUp?.watch(channel, item.block.program);
                } else if (result === 'copy-catchup-url') {
                    catchUp?.copyUrl?.(channel, item.block.program);
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
                : rows.findIndex((row) => row.id === hit.channelId);
        const channel = rowIndex < 0 ? null : rows[rowIndex];
        if (channel) {
            this.host.focusRow(rowIndex);
        }
        const catchUp = channel ? this.host.catchUp() : undefined;
        const canWatch =
            channel && catchUp
                ? catchUp.canWatch(channel, hit.program)
                : false;
        const startMs = this.searchHitStartMs(hit);
        const stopMs = getProgramTimeMs(
            hit.program.stop,
            hit.program.stopTimestamp,
            this.host.offsetMinutes()
        );
        const isNow = startMs <= Date.now() && stopMs > Date.now();
        this.programmeDialog
            .open({
                ...hit.program,
                channelName: channel?.name ?? hit.channelName ?? null,
                channelLogo: channel?.logoUrl,
                archiveUrlAvailable: canWatch && !!catchUp?.copyUrl,
                primaryAction: isNow
                    ? 'live'
                    : canWatch
                      ? 'timeshift'
                      : null,
                archiveUnavailableNote: !!channel && !isNow && !canWatch,
            })
            .subscribe((result: EpgItemDialogAction | undefined) => {
                if (!channel) {
                    return;
                }
                if (result === 'live') {
                    this.host.activate(channel);
                } else if (result === 'timeshift') {
                    catchUp?.watch(channel, hit.program);
                } else if (result === 'copy-catchup-url') {
                    catchUp?.copyUrl?.(channel, hit.program);
                }
            });
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

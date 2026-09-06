import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import {
    buildGuideRowBlocks,
    EPG_GUIDE_ZOOM_DEFAULT,
    EpgGuideDayAxis,
    EpgGuideDensity,
    guideTrackWidthPx,
} from './epg-guide-layout.util';
import { EpgGuideRowStatus } from './epg-guide-programs.service';
import { EpgGuideChannel } from './epg-guide-source';

/**
 * One channel row: the sticky channel cell and the lane with positioned
 * programme cards. Layout is recomputed only when its own inputs change, so a
 * 2000-row guide re-lays-out one row per programme batch, not the grid.
 */
@Component({
    selector: 'app-epg-guide-row',
    imports: [DatePipe, MatIconModule, MatTooltipModule, TranslatePipe],
    templateUrl: './epg-guide-row.component.html',
    styleUrl: './epg-guide-row.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'epg-guide-row',
        role: 'row',
        '[class.is-active]': 'active()',
        '[class.is-focused]': 'rowFocused()',
        '[class.is-compact]': 'density() === "compact"',
    },
})
export class EpgGuideRowComponent {
    readonly channel = input.required<EpgGuideChannel>();
    readonly programs = input<readonly EpgProgram[]>([]);
    readonly status = input<EpgGuideRowStatus>('idle');
    readonly axis = input.required<EpgGuideDayAxis>();
    readonly hourWidthPx = input(EPG_GUIDE_ZOOM_DEFAULT);
    readonly nowMs = input(0);
    readonly offsetMinutes = input(0);
    readonly catchUpAvailable = input(false);
    readonly active = input(false);
    readonly density = input<EpgGuideDensity>('comfortable');
    readonly rowFocused = input(false);
    readonly focusedBlock = input<number | null>(null);
    /**
     * True when this row owns the grid's single `tabindex="0"` — the shell
     * hands it to the focused row, else the playing one, else the first, so
     * Tab always reaches the grid.
     */
    readonly tabbable = input(false);

    /** Single click on the channel cell or the on-now card. */
    readonly channelActivated = output<void>();
    /** Double click: activate and close the guide. */
    readonly channelCommitted = output<void>();
    readonly detailsRequested = output<TimelineRenderBlock>();
    readonly watchRequested = output<TimelineRenderBlock>();
    /**
     * A pointer landed on a grid cell: the block's index, or `null` for the
     * channel cell. The shell moves its keyboard focus there so the roving
     * tabindex follows the mouse.
     */
    readonly focusRequested = output<number | null>();

    readonly blocks = computed(() =>
        buildGuideRowBlocks(this.programs(), {
            axis: this.axis(),
            hourWidthPx: this.hourWidthPx(),
            nowMs: this.nowMs(),
            offsetMinutes: this.offsetMinutes(),
            catchUpAvailable: this.catchUpAvailable(),
        })
    );
    readonly nowBlock = computed(
        () => this.blocks().find((item) => item.block.when === 'now') ?? null
    );
    readonly trackWidthPx = computed(() =>
        guideTrackWidthPx(this.axis(), this.hourWidthPx())
    );
    readonly showEmpty = computed(
        () =>
            this.status() === 'none' ||
            (this.status() === 'loaded' && this.blocks().length === 0)
    );
    readonly isLoading = computed(() => this.status() === 'loading');

    /** This row holds the roving `tabindex="0"` while it is focused or picked. */
    private readonly roving = computed(
        () => this.tabbable() || this.rowFocused()
    );
    readonly channelTabIndex = computed(() =>
        this.roving() && this.focusedBlock() === null ? 0 : -1
    );

    blockTabIndex(index: number): number {
        return this.roving() && this.focusedBlock() === index ? 0 : -1;
    }

    onChannelClick(): void {
        this.focusRequested.emit(null);
        this.channelActivated.emit();
    }

    onBlockClick(item: TimelineRenderBlock, index: number): void {
        this.focusRequested.emit(index);
        if (item.block.when === 'now') {
            this.channelActivated.emit();
        } else {
            this.detailsRequested.emit(item);
        }
    }

    onBlockDoubleClick(item: TimelineRenderBlock): void {
        if (item.block.when === 'now') {
            this.channelCommitted.emit();
        }
    }

    onWatchClick(event: Event, item: TimelineRenderBlock): void {
        event.stopPropagation();
        this.watchRequested.emit(item);
    }
}

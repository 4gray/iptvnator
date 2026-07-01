import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    HostBinding,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { areProgramsSame } from '../epg-program.utils';
import {
    TimelineBlock,
    TimelineDayDivider,
    TimelineRenderBlock,
    TimelineRenderGroup,
    TimelineRenderItem,
    TimelineTick,
} from './epg-timeline.utils';

interface PopoverState {
    readonly title: string;
    readonly desc: string | null;
    readonly startMs: number;
    readonly stopMs: number;
    readonly durationMin: number;
    readonly left: number;
    readonly top: number;
}

/**
 * The scrolling ribbon canvas: ticks, day dividers, programme blocks (with
 * width-adaptive content tiers), short-run group chips, the live playhead, and
 * the hover/focus popover that reveals truncated programme names.
 */
@Component({
    selector: 'app-epg-timeline-track',
    templateUrl: './epg-timeline-track.component.html',
    styleUrl: './epg-timeline-track.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe, MatIcon, TranslatePipe],
})
export class EpgTimelineTrackComponent {
    readonly items = input<TimelineRenderItem[]>([]);
    readonly ticks = input<TimelineTick[]>([]);
    readonly dividers = input<TimelineDayDivider[]>([]);
    readonly scale = input(1);
    readonly trackWidthPx = input(0);
    readonly playheadLeftPx = input(0);
    readonly nowLabel = input('');
    readonly selectedKey = input<string | null>(null);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly currentLocale = input('en');

    readonly blockClick = output<TimelineBlock>();
    readonly watchClick = output<TimelineBlock>();
    readonly infoClick = output<TimelineBlock>();
    readonly groupExpand = output<TimelineRenderGroup>();

    readonly popover = signal<PopoverState | null>(null);

    @HostBinding('style.width.px') get hostWidth(): number {
        return this.trackWidthPx();
    }

    readonly activeKey = computed(() => {
        const active = this.activeProgram();
        if (!active) {
            return null;
        }
        const match = this.items().find(
            (item): item is TimelineRenderBlock =>
                item.kind === 'block' &&
                areProgramsSame(item.block.program, active)
        );
        return match?.key ?? null;
    });

    isSelected(item: TimelineRenderBlock): boolean {
        return this.selectedKey() === item.block.key;
    }

    isPlaying(item: TimelineRenderBlock): boolean {
        return this.activeKey() === item.key;
    }

    /**
     * Emit block activation for keyboard Enter only when the block itself is
     * focused. Enter on a nested watch/info button bubbles here too — ignore it
     * so keyboard users get the button's own action, matching mouse clicks
     * (which `stopPropagation()` on those buttons).
     */
    onBlockActivate(event: Event, block: TimelineBlock): void {
        if (event.target === event.currentTarget) {
            this.blockClick.emit(block);
        }
    }

    onBlockEnter(item: TimelineRenderBlock, event: Event): void {
        if (item.tier === 'wide') {
            this.popover.set(null);
            return;
        }
        const target = event.currentTarget as HTMLElement | null;
        if (!target) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const width = 248;
        const estHeight = 132;
        // The EPG panel sits at the bottom of the screen, so flip the popover
        // above the block when there isn't room for it below.
        const below = rect.bottom + 8;
        const flipAbove = below + estHeight > window.innerHeight;
        this.popover.set({
            title: item.block.program.title,
            desc: item.block.program.desc,
            startMs: item.block.startMs,
            stopMs: item.block.stopMs,
            durationMin: Math.round(item.block.durationMin),
            left: Math.max(
                12,
                Math.min(
                    window.innerWidth - width - 12,
                    rect.left + rect.width / 2 - width / 2
                )
            ),
            top: flipAbove
                ? Math.max(12, rect.top - estHeight - 8)
                : below,
        });
    }

    onBlockLeave(): void {
        this.popover.set(null);
    }
}

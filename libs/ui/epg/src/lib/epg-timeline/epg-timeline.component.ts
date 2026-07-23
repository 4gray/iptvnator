import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    linkedSignal,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    EpgDateNavigationDirection,
    getTodayEpgDateKey,
    parseEpgDateKey,
    shiftEpgDateKey,
} from '../epg-date';
import { EpgItemDialogAction } from '../epg-item-description/epg-item-description.component';
import type { EpgProgramActivationEvent } from '../epg-program-activation-event';
import {
    canScheduleEpgRecording,
    createEpgRecordingRequestEvent,
    EpgRecordingRequestEvent,
} from '../epg-recording-request-event';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import {
    EpgTimelineSummary,
    formatClockTime,
    summaryHasTimeRange,
    summaryHasTitle,
    summaryMinutesLeft,
    summaryProgress,
} from './epg-summary.util';
import { canCatchUpProgramme, epgDialogActionFor } from './epg-archive.util';
import {
    EpgTimelineEmptyReason,
    EpgTimelineEmptyStateComponent,
} from './epg-timeline-empty-state.component';
import { TimelineScrollController } from './epg-timeline-scroll.controller';
import { EpgTimelineTrackComponent } from './epg-timeline-track.component';
import * as timeline from './epg-timeline.utils';

type RenderState = 'loading' | 'ribbon' | EpgTimelineEmptyReason;

export type { EpgTimelineSummary } from './epg-summary.util';

@Component({
    selector: 'app-epg-timeline',
    templateUrl: './epg-timeline.component.html',
    styleUrl: './epg-timeline.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DatePipe,
        EpgTimelineEmptyStateComponent,
        EpgTimelineTrackComponent,
        MatIcon,
        MatTooltip,
        TranslatePipe,
    ],
})
export class EpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly sourceLabel = input('Timeline');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly recordingAvailable = input(false);
    readonly recordingFutureAvailable = input(true);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly loading = input(false);
    readonly emptyReason = input<EpgTimelineEmptyReason>('none');
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<EpgTimelineSummary | null>(null);
    readonly summaryLabelKey = input('EPG.CURRENT_PROGRAM');

    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly recordingRequested = output<EpgRecordingRequestEvent>();
    readonly returnToLive = output<void>();
    readonly selectedDateChange = output<string>();
    readonly openEpgSettings = output<void>();
    readonly retry = output<void>();
    readonly collapsedChange = output<boolean>();

    private readonly programmeDialog = inject(EpgProgrammeDialogService);
    private readonly translate = inject(TranslateService);

    readonly ribbon = viewChild<ElementRef<HTMLElement>>('ribbon');
    /** px-per-minute zoom (D). */
    readonly scale = signal(timeline.TIMELINE_DEFAULT_SCALE);
    readonly zoomMin = timeline.TIMELINE_ZOOM_MIN;
    readonly zoomMax = timeline.TIMELINE_ZOOM_MAX;
    readonly zoomStep = timeline.TIMELINE_ZOOM_STEP;
    readonly skeletonWidths = [120, 170, 150, 200, 140, 180];

    private readonly nowMs = signal(Date.now());
    readonly selectedKey = signal<string | null>(null);
    /** Day centred in the ribbon, seeded from the controlled `selectedDate` so
     * a non-today date survives (re)mount and follows host changes. */
    private readonly viewDayKey = linkedSignal(() => {
        const key = this.selectedDate()?.trim();
        return key ? key : getTodayEpgDateKey();
    });

    /** Ribbon scrolling + channel-select auto-focus, extracted from the view. */
    private readonly scroll = new TimelineScrollController({
        ribbon: () => this.ribbon()?.nativeElement,
        scale: () => this.scale(),
        axis: () => this.axis(),
        blocks: () => this.blocks(),
        nowMs: () => this.nowMs(),
        viewDayKey: () => this.viewDayKey(),
        commitDay: (dayKey) => this.commitDay(dayKey),
        hasProgramsForDay: (dayKey) =>
            timeline.hasProgramsForDateKey(this.programs(), dayKey),
    });

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    readonly axis = computed(() =>
        timeline.buildTimelineAxis(this.programs(), this.nowMs())
    );
    readonly blocks = computed(() =>
        timeline.buildTimelineBlocks(this.programs(), this.axis(), this.nowMs())
    );
    private readonly archiveWindowStartMs = computed(() => {
        const days = this.archiveDays();
        return days > 0
            ? this.nowMs() - days * 24 * 60 * timeline.TIMELINE_MINUTE_MS
            : Number.NEGATIVE_INFINITY;
    });
    readonly renderItems = computed(() =>
        timeline.buildTimelineRenderItems(this.blocks(), this.scale(), {
            allowGroup: this.scale() < timeline.TIMELINE_GROUP_ZOOM_MAX,
            nowMs: this.nowMs(),
            archivePlaybackAvailable: this.archivePlaybackAvailable(),
            archiveWindowStartMs: this.archiveWindowStartMs(),
        })
    );
    readonly ticks = computed(() =>
        timeline.buildTimelineTicks(
            this.axis(),
            timeline.timelineTickStepForScale(this.scale())
        )
    );
    readonly dividers = computed(() =>
        timeline.buildTimelineDayDividers(this.axis())
    );
    readonly trackWidthPx = computed(() => {
        const axis = this.axis();
        return (
            ((axis.endMs - axis.startMs) / timeline.TIMELINE_MINUTE_MS) *
            this.scale()
        );
    });
    readonly playheadLeftPx = computed(() => {
        const axis = this.axis();
        return (
            ((this.nowMs() - axis.startMs) / timeline.TIMELINE_MINUTE_MS) *
            this.scale()
        );
    });
    readonly zoomLabelKey = computed(() => {
        const scale = this.scale();
        if (scale < timeline.TIMELINE_GROUP_ZOOM_MAX)
            return 'EPG.TIMELINE.ZOOM_DAY';
        if (scale < 3) return 'EPG.TIMELINE.ZOOM_HOURS';
        return 'EPG.TIMELINE.ZOOM_DETAIL';
    });
    readonly nowLabel = computed(() => formatClockTime(this.nowMs()));

    readonly viewDate = computed(() => parseEpgDateKey(this.viewDayKey()));
    readonly isViewToday = computed(
        () => this.viewDayKey() === getTodayEpgDateKey()
    );

    readonly renderState = computed<RenderState>(() => {
        if (this.loading()) {
            return 'loading';
        }
        const reason = this.emptyReason();
        if (reason !== 'none') {
            return reason;
        }
        if (this.programs().length === 0) {
            return 'channel-unmapped';
        }
        if (
            !timeline.hasProgramsForDateKey(this.programs(), this.viewDayKey())
        ) {
            return 'empty-day';
        }
        return 'ribbon';
    });
    readonly emptyStateReason = computed<EpgTimelineEmptyReason>(() => {
        const state = this.renderState();
        return state === 'loading' || state === 'ribbon' ? 'none' : state;
    });
    readonly hasOtherDays = computed(() => this.programs().length > 0);

    /**
     * "Now" + zoom act on the ribbon, so they only make sense when a ribbon is
     * rendered. Hidden (not disabled) otherwise — a disabled control implies it
     * could become usable, but with no programmes for the day there is nothing
     * to jump to or zoom.
     */
    readonly showRibbonControls = computed(
        () => this.renderState() === 'ribbon'
    );

    /**
     * The date stepper navigates between days, which is only meaningful when the
     * channel has EPG on *some* day: the live ribbon, or `empty-day` (data
     * exists, just not the viewed day). Hidden for the no-EPG-anywhere states
     * (`channel-unmapped`, `provider-no-epg`, `m3u-needs-setup`, `error`) and
     * while loading.
     */
    readonly showDateStepper = computed(() => {
        const state = this.renderState();
        return state === 'ribbon' || state === 'empty-day';
    });

    // ── collapsed-summary state ──
    readonly hasSummary = computed(() => summaryHasTitle(this.summary()));
    readonly hasTimeRange = computed(() => summaryHasTimeRange(this.summary()));
    readonly progress = computed(() =>
        summaryProgress(this.summary(), this.nowMs())
    );
    readonly minutesLeft = computed(() =>
        summaryMinutesLeft(this.summary(), this.nowMs())
    );

    constructor() {
        effect((onCleanup) => {
            const intervalId = window.setInterval(
                () => this.nowMs.set(Date.now()),
                30_000
            );
            onCleanup(() => clearInterval(intervalId));
        });

        effect(() => {
            const scroller = this.ribbon()?.nativeElement;
            const programs = this.programs();
            untracked(() => this.scroll.maybeAutoFocus(scroller, programs));
        });
    }

    toggleCollapsed(): void {
        this.collapsedChange.emit(!this.collapsed());
    }

    onZoom(value: number): void {
        this.scale.set(
            timeline.updateTimelineZoom(
                value,
                this.scale(),
                this.zoomMin,
                this.zoomMax,
                this.ribbon()?.nativeElement
            )
        );
    }

    onGroupExpand(group: timeline.TimelineRenderGroup): void {
        this.scale.set(timeline.TIMELINE_GROUP_EXPAND_ZOOM);
        const axis = this.axis();
        const centreMs = (group.startMs + group.stopMs) / 2;
        const offsetMin =
            (centreMs - axis.startMs) / timeline.TIMELINE_MINUTE_MS;
        this.scroll.scrollToOffset(offsetMin, 0.5);
    }

    canCatchUp(block: timeline.TimelineBlock): boolean {
        return canCatchUpProgramme(
            block.when,
            block.startMs,
            this.archivePlaybackAvailable(),
            this.archiveDays(),
            this.nowMs()
        );
    }

    onBlockClick(block: timeline.TimelineBlock): void {
        this.selectedKey.set(block.key);
        if (this.canCatchUp(block)) {
            this.programActivated.emit({
                program: block.program,
                type: 'timeshift',
            });
            return;
        }
        if (block.when === 'now') {
            this.returnToLive.emit();
        }
    }

    onWatch(block: timeline.TimelineBlock): void {
        this.selectedKey.set(block.key);
        this.programActivated.emit({
            program: block.program,
            type: 'timeshift',
        });
    }

    openDetails(block: timeline.TimelineBlock): void {
        this.programmeDialog
            .open({
                ...block.program,
                channelName: this.channelName(),
                channelLogo: this.channelLogo(),
                primaryAction: epgDialogActionFor(
                    block.when,
                    this.canCatchUp(block)
                ),
                archiveUnavailableNote:
                    block.when === 'past' && !this.archivePlaybackAvailable(),
                recordingAvailable: canScheduleEpgRecording(
                    this.recordingAvailable(),
                    this.recordingFutureAvailable(),
                    block.when
                ),
            })
            .subscribe((result: EpgItemDialogAction | undefined) => {
                if (result === 'live') {
                    this.returnToLive.emit();
                } else if (result === 'timeshift') {
                    this.selectedKey.set(block.key);
                    this.programActivated.emit({
                        program: block.program,
                        type: 'timeshift',
                    });
                } else if (result === 'record') {
                    this.recordingRequested.emit(
                        createEpgRecordingRequestEvent(
                            block.program,
                            block.startMs,
                            block.stopMs
                        )
                    );
                }
            });
    }

    stepDay(direction: EpgDateNavigationDirection): void {
        const nextKey = shiftEpgDateKey(this.viewDayKey(), direction);
        this.commitDay(nextKey);
        this.scroll.scrollToDateKey(nextKey, 0.5);
    }

    jumpToNow(): void {
        this.commitDay(getTodayEpgDateKey());
        this.scroll.focusCurrentProgram(true);
    }

    jumpToNearestDay(): void {
        const nearest = timeline.nearestDateKeyWithPrograms(
            this.programs(),
            this.nowMs()
        );
        if (nearest) {
            this.commitDay(nearest);
            this.scroll.scrollToDateKey(nearest, 0.5);
        }
    }

    onRibbonScroll(): void {
        this.scroll.onRibbonScroll();
    }

    private commitDay(dayKey: string): void {
        if (dayKey === this.viewDayKey()) {
            return;
        }
        this.viewDayKey.set(dayKey);
        this.selectedDateChange.emit(dayKey);
    }
}

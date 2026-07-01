import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    input,
    linkedSignal,
    output,
    signal,
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
import { EpgItemDialogAction } from '../epg-list/epg-item-description/epg-item-description.component';
import type { EpgProgramActivationEvent } from '../epg-list/epg-list.component';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { epgDialogActionFor } from '../epg-timeline/epg-archive.util';
import {
    EpgTimelineSummary,
    summaryHasTimeRange,
    summaryHasTitle,
    summaryMinutesLeft,
    summaryProgress,
} from '../epg-timeline/epg-summary.util';
import {
    EpgTimelineEmptyReason,
    EpgTimelineEmptyStateComponent,
} from '../epg-timeline/epg-timeline-empty-state.component';
import {
    hasProgramsForDateKey,
    nearestDateKeyWithPrograms,
} from '../epg-timeline/epg-timeline.utils';
import { EpgListScrollController } from './epg-list-scroll.controller';
import { EpgListViewRowComponent } from './epg-list-view-row/epg-list-view-row.component';
import { registerEpgListViewEffects } from './epg-list-view.effects';
import { buildEpgListRows, EpgListRow } from './epg-list-view.utils';

type RenderState = 'loading' | 'list' | EpgTimelineEmptyReason;

/**
 * Vertical, single-day EPG list — a drop-in alternative to `app-epg-timeline`
 * with an identical controlled input/output contract, so hosts swap the two
 * with a plain `@if`. Reuses the timeline's view-agnostic modules (archive
 * gating, summary maths, date helpers, empty-state, details dialog); drops all
 * ribbon geometry, zoom, and horizontal scroll.
 */
@Component({
    selector: 'app-epg-list-view',
    templateUrl: './epg-list-view.component.html',
    styleUrl: './epg-list-view.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DatePipe,
        EpgListViewRowComponent,
        EpgTimelineEmptyStateComponent,
        MatIcon,
        MatTooltip,
        TranslatePipe,
    ],
})
export class EpgListViewComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    /** Same input as the timeline's, but a list-appropriate default: hosts
     * that don't pass a label (M3U, unified tab) would otherwise show the
     * timeline's literal "Timeline" while in list mode. */
    readonly sourceLabel = input('Programme guide');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly loading = input(false);
    readonly emptyReason = input<EpgTimelineEmptyReason>('none');
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<EpgTimelineSummary | null>(null);
    readonly summaryLabelKey = input('EPG.CURRENT_PROGRAM');

    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly returnToLive = output<void>();
    readonly selectedDateChange = output<string>();
    readonly openEpgSettings = output<void>();
    readonly retry = output<void>();
    readonly collapsedChange = output<boolean>();

    private readonly programmeDialog = inject(EpgProgrammeDialogService);
    private readonly translate = inject(TranslateService);

    readonly list = viewChild<ElementRef<HTMLElement>>('list');
    readonly nowMs = signal(Date.now());
    readonly selectedKey = signal<string | null>(null);
    readonly nowStripVisible = signal(false);

    /** Day shown, seeded from the controlled `selectedDate` so a non-today
     * date survives (re)mount and follows host changes — same as the timeline. */
    private readonly viewDayKey = linkedSignal(() => {
        const key = this.selectedDate()?.trim();
        return key ? key : getTodayEpgDateKey();
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

    readonly rows = computed<EpgListRow[]>(() =>
        buildEpgListRows(this.programs(), this.viewDayKey(), this.nowMs(), {
            archivePlaybackAvailable: this.archivePlaybackAvailable(),
            archiveDays: this.archiveDays(),
            activeProgram: this.activeProgram(),
        })
    );
    readonly nowRow = computed<EpgListRow | null>(
        () => this.rows().find((row) => row.when === 'now') ?? null
    );
    readonly nowRowMinutesLeft = computed(() => {
        const row = this.nowRow();
        return row ? Math.max(0, Math.round((row.stopMs - this.nowMs()) / 60_000)) : null;
    });

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
        if (!hasProgramsForDateKey(this.programs(), this.viewDayKey())) {
            return 'empty-day';
        }
        return 'list';
    });
    readonly emptyStateReason = computed<EpgTimelineEmptyReason>(() => {
        const state = this.renderState();
        return state === 'loading' || state === 'list' ? 'none' : state;
    });
    readonly hasOtherDays = computed(() => this.programs().length > 0);
    readonly showDateStepper = computed(() => {
        const state = this.renderState();
        return state === 'list' || state === 'empty-day';
    });
    /** "Now" jump: only useful off-today or while watching archive. */
    readonly showJump = computed(
        () =>
            this.renderState() === 'list' &&
            (!this.isViewToday() || !this.isLivePlayback())
    );
    readonly skeletonRows = [0, 1, 2, 3, 4, 5];

    // ── collapsed-summary state (reused from the timeline) ──
    readonly hasSummary = computed(() => summaryHasTitle(this.summary()));
    readonly hasTimeRange = computed(() => summaryHasTimeRange(this.summary()));
    readonly progress = computed(() =>
        summaryProgress(this.summary(), this.nowMs())
    );
    readonly minutesLeft = computed(() =>
        summaryMinutesLeft(this.summary(), this.nowMs())
    );

    private readonly scroll = new EpgListScrollController({
        list: () => this.list()?.nativeElement,
        isViewToday: () => this.isViewToday(),
        setNowStripVisible: (visible) => this.nowStripVisible.set(visible),
        hasProgramsToday: () =>
            hasProgramsForDateKey(this.programs(), getTodayEpgDateKey()),
        commitToday: () => this.commitDay(getTodayEpgDateKey()),
    });

    constructor() {
        registerEpgListViewEffects({
            nowMs: this.nowMs,
            list: () => this.list()?.nativeElement,
            rows: () => this.rows(),
            programs: () => this.programs(),
            isViewToday: () => this.isViewToday(),
            channelName: () => this.channelName(),
            scroll: this.scroll,
        });
    }

    toggleCollapsed(): void {
        this.collapsedChange.emit(!this.collapsed());
    }

    stepDay(direction: EpgDateNavigationDirection): void {
        this.commitDay(shiftEpgDateKey(this.viewDayKey(), direction));
        this.scroll.resetListScroll();
    }

    jumpToNow(): void {
        this.commitDay(getTodayEpgDateKey());
        // Deferred: when jumping from another day, today's rows only exist
        // after the next render. Deliberate user action → animate.
        this.scroll.focusNowAfterRender(true);
    }

    jumpToNearestDay(): void {
        const nearest = nearestDateKeyWithPrograms(
            this.programs(),
            this.nowMs()
        );
        if (nearest) {
            this.commitDay(nearest);
            this.scroll.resetListScroll();
        }
    }

    onRowActivate(row: EpgListRow): void {
        this.selectedKey.set(row.key);
        if (row.when === 'now') {
            this.returnToLive.emit();
            return;
        }
        if (row.canCatchUp) {
            this.programActivated.emit({
                program: row.program,
                type: 'timeshift',
            });
        }
    }

    onWatch(row: EpgListRow): void {
        this.selectedKey.set(row.key);
        this.programActivated.emit({ program: row.program, type: 'timeshift' });
    }

    openDetails(row: EpgListRow): void {
        this.programmeDialog
            .open({
                ...row.program,
                channelName: this.channelName(),
                channelLogo: this.channelLogo(),
                primaryAction: epgDialogActionFor(row.when, row.canCatchUp),
                archiveUnavailableNote:
                    row.when === 'past' && !this.archivePlaybackAvailable(),
            })
            .subscribe((result: EpgItemDialogAction | undefined) => {
                if (result === 'live') {
                    this.returnToLive.emit();
                } else if (result === 'timeshift') {
                    this.selectedKey.set(row.key);
                    this.programActivated.emit({
                        program: row.program,
                        type: 'timeshift',
                    });
                }
            });
    }

    onListScroll(): void {
        this.scroll.updateNowStrip();
    }

    private commitDay(dayKey: string): void {
        if (dayKey === this.viewDayKey()) {
            return;
        }
        this.viewDayKey.set(dayKey);
        this.selectedDateChange.emit(dayKey);
    }
}

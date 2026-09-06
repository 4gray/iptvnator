import {
    CdkVirtualScrollViewport,
    ScrollingModule,
} from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    HostListener,
    inject,
    OnDestroy,
    OnInit,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram, epgProviderClockMs } from '@iptvnator/shared/interfaces';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    EpgDateNavigationDirection,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '../epg-date';
import { EpgItemDialogAction } from '../epg-item-description/epg-item-description.component';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import { EpgGuideKeyboardController } from './epg-guide-keyboard.controller';
import {
    buildGuideDayAxis,
    buildGuideRowBlocks,
    buildGuideTicks,
    EPG_GUIDE_CHANNEL_COLUMN_PX,
    EPG_GUIDE_ROW_HEIGHT_PX,
    EpgGuideDensity,
    guideNowLeftPx,
    guideTrackWidthPx,
} from './epg-guide-layout.util';
import {
    clampGuideZoom,
    persistEpgGuidePreferences,
    restoreEpgGuidePreferences,
} from './epg-guide-preferences';
import {
    EpgGuideProgramsService,
    EpgGuideRowStatus,
} from './epg-guide-programs.service';
import { EpgGuideRowComponent } from './epg-guide-row.component';
import { EpgGuideSearchController } from './epg-guide-search.controller';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideSearchHit,
} from './epg-guide-source';
import { EpgGuideToolbarComponent } from './epg-guide-toolbar.component';
import { EpgGuideViewportController } from './epg-guide-viewport.controller';

/**
 * Multi-channel programme guide. Reads everything from `EPG_GUIDE_SOURCE`;
 * owns the selected day, zoom, density, filters and keyboard navigation.
 * Rows are virtualised; the channel column and the ruler are sticky.
 */
@Component({
    selector: 'app-epg-guide',
    imports: [
        DatePipe,
        MatButtonModule,
        MatIconModule,
        ScrollingModule,
        TranslatePipe,
        EpgGuideRowComponent,
        EpgGuideToolbarComponent,
    ],
    providers: [EpgGuideProgramsService],
    templateUrl: './epg-guide.component.html',
    styleUrl: './epg-guide.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgGuideComponent implements OnInit, OnDestroy {
    private readonly source = inject(EPG_GUIDE_SOURCE);
    private readonly programsService = inject(EpgGuideProgramsService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly programmeDialog = inject(EpgProgrammeDialogService);
    private readonly dialog = inject(MatDialog);
    private readonly translate = inject(TranslateService);
    private readonly destroyRef = inject(DestroyRef);

    readonly close = output<void>();
    readonly channelActivated = output<string>();

    readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');

    private readonly preferences = restoreEpgGuidePreferences();
    readonly dayKey = signal(getTodayEpgDateKey());
    readonly zoom = signal(this.preferences.zoom);
    readonly density = signal<EpgGuideDensity>(this.preferences.density);
    readonly onlyWithEpg = signal(this.preferences.onlyWithEpg);
    readonly filter = signal('');
    readonly nowMs = signal(Date.now());
    readonly scrollLeft = signal(0);

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
    readonly offsetMinutes = this.settingsStore.resolvedEpgOffsetMinutes;
    readonly scopes = this.source.scopes;
    readonly scopeId = this.source.scopeId;
    readonly activeChannelId = this.source.activeChannelId;
    readonly coverageLoaded = this.programsService.coverageLoaded;
    private readonly search = new EpgGuideSearchController(
        this.source.searchPrograms?.bind(this.source)
    );
    readonly searchEnabled = this.search.enabled;
    readonly searchQuery = this.search.query;
    readonly searchResults = this.search.results;
    readonly searchPanelVisible = this.search.panelVisible;
    readonly catchUpAvailable = this.source.catchUp !== undefined;
    readonly channelColumnPx = EPG_GUIDE_CHANNEL_COLUMN_PX;

    readonly axis = computed(() => buildGuideDayAxis(this.dayKey()));
    readonly isToday = computed(() => {
        this.nowMs();
        return this.dayKey() === getTodayEpgDateKey();
    });
    readonly ticks = computed(() => buildGuideTicks(this.axis(), this.zoom()));
    readonly trackWidthPx = computed(() =>
        guideTrackWidthPx(this.axis(), this.zoom())
    );
    readonly nowLeftPx = computed(() =>
        guideNowLeftPx(this.axis(), this.nowMs(), this.zoom())
    );
    /**
     * The now-line's x inside the scrolling lane, or `null` when it is not on
     * the selected day or has scrolled behind the sticky channel column — the
     * clip layer starts at the column's right edge, so a negative offset would
     * otherwise be painted under it.
     */
    readonly nowLineLeftPx = computed(() => {
        const nowX = this.nowLeftPx();
        if (nowX === null) {
            return null;
        }
        const left = nowX - this.scrollLeft();
        return left >= 0 ? left : null;
    });
    readonly rowHeightPx = computed(
        () => EPG_GUIDE_ROW_HEIGHT_PX[this.density()]
    );
    readonly totalCount = computed(() => this.source.channels().length);
    readonly rows = computed(() => {
        const needle = this.filter().trim().toLowerCase();
        const onlyWithEpg = this.onlyWithEpg();
        return this.source
            .channels()
            .filter(
                (channel) =>
                    (!needle || channel.name.toLowerCase().includes(needle)) &&
                    (!onlyWithEpg || this.programsService.isCovered(channel.id))
            );
    });
    readonly activeRowIndex = computed(() => {
        const activeId = this.activeChannelId();
        return activeId === null
            ? -1
            : this.rows().findIndex((channel) => channel.id === activeId);
    });

    private readonly keyboard = new EpgGuideKeyboardController({
        rowCount: () => this.rows().length,
        blockCount: (row) => this.blocksFor(row).length,
        activeRow: () => this.activeRowIndex(),
        isBlocked: () => this.dialog.openDialogs.length > 0,
        play: (row) => this.commitRow(this.rows()[row]),
        details: (row, block) =>
            this.openDetails(this.rows()[row], this.blocksFor(row)[block]),
        jumpNow: () => this.jumpNow(),
        stepDay: (direction) => this.stepDay(direction),
        close: () => this.close.emit(),
    });
    readonly focus = this.keyboard.focus;

    private readonly viewportController = new EpgGuideViewportController({
        viewport: () => this.viewport(),
        rows: () => this.rows(),
        rowHeightPx: () => this.rowHeightPx(),
        channelColumnPx: () => this.channelColumnPx,
        blocksFor: (row) => this.blocksFor(row),
        activeRow: () => this.activeRowIndex(),
        ensureLoaded: (channels) => this.programsService.ensureLoaded(channels),
        setScrollLeft: (left) => this.scrollLeft.set(left),
    });

    private minuteTimer?: number;

    constructor() {
        effect(() => {
            const axis = this.axis();
            const offset = this.offsetMinutes();
            untracked(() => {
                this.programsService.setWindow(
                    epgProviderClockMs(axis.startMs, offset),
                    epgProviderClockMs(axis.endMs, offset)
                );
                this.viewportController.loadRenderedRange();
            });
        });
        effect(() => {
            this.rows();
            untracked(() => this.viewportController.loadRenderedRange());
        });
        effect(() =>
            persistEpgGuidePreferences({
                density: this.density(),
                zoom: this.zoom(),
                onlyWithEpg: this.onlyWithEpg(),
            })
        );
        effect(() => {
            const viewport = this.viewport();
            if (!viewport) {
                return;
            }
            untracked(() =>
                this.viewportController.watch(viewport, this.destroyRef)
            );
        });
        afterNextRender(() => this.jumpNow(false));
    }

    ngOnInit(): void {
        this.minuteTimer = window.setInterval(
            () => this.nowMs.set(Date.now()),
            60_000
        );
    }

    ngOnDestroy(): void {
        window.clearInterval(this.minuteTimer);
        this.search.destroy();
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if (this.keyboard.handle(event)) {
            event.preventDefault();
            this.viewportController.revealFocus(this.focus());
        }
    }

    trackRow(_index: number, channel: EpgGuideChannel): string {
        return `${channel.number}:${channel.id}`;
    }

    programsFor(channelId: string): readonly EpgProgram[] {
        return this.programsService.programsFor(channelId);
    }

    statusFor(channelId: string): EpgGuideRowStatus {
        return this.programsService.statusFor(channelId);
    }

    focusedBlockFor(row: number): number | null {
        const focused = this.focus();
        return focused?.row === row ? focused.block : null;
    }

    stepDay(direction: EpgDateNavigationDirection): void {
        this.dayKey.set(shiftEpgDateKey(this.dayKey(), direction));
        this.focus.set(null);
    }

    jumpNow(animate = true): void {
        this.dayKey.set(getTodayEpgDateKey());
        this.nowMs.set(Date.now());
        this.viewportController.scrollToNow(this.nowLeftPx(), animate);
    }

    setScope(scopeId: string): void {
        this.source.setScope(scopeId);
        this.focus.set(null);
    }

    setOnlyWithEpg(value: boolean): void {
        this.onlyWithEpg.set(value);
    }

    setDensity(value: EpgGuideDensity): void {
        this.density.set(value);
    }

    setZoom(value: number): void {
        this.zoom.set(clampGuideZoom(value));
    }

    setFilter(value: string): void {
        this.filter.set(value);
        this.focus.set(null);
    }

    onSearchQueryChange(query: string): void {
        this.search.setQuery(query);
    }

    /**
     * Open a search hit. When the host resolved the hit's row, focus and reveal
     * it and label the dialog with that channel; an unresolved hit still opens,
     * just without a channel.
     */
    openSearchResult(hit: EpgGuideSearchHit): void {
        const rowIndex =
            hit.channelId === null
                ? -1
                : this.rows().findIndex((row) => row.id === hit.channelId);
        const channel = rowIndex < 0 ? null : this.rows()[rowIndex];
        if (channel) {
            this.focus.set({ row: rowIndex, block: null });
            this.viewportController.revealFocus(this.focus());
        }
        this.programmeDialog
            .open(
                channel
                    ? {
                          ...hit.program,
                          channelName: channel.name,
                          channelLogo: channel.logoUrl,
                      }
                    : { ...hit.program }
            )
            .subscribe();
    }

    activateRow(channel: EpgGuideChannel | undefined): void {
        if (!channel) {
            return;
        }
        this.source.activate(channel.id);
        this.channelActivated.emit(channel.id);
    }

    commitRow(channel: EpgGuideChannel | undefined): void {
        if (!channel) {
            return;
        }
        this.activateRow(channel);
        this.close.emit();
    }

    openDetails(
        channel: EpgGuideChannel | undefined,
        item: TimelineRenderBlock | undefined
    ): void {
        if (!channel || !item) {
            return;
        }
        const when = item.block.when;
        this.programmeDialog
            .open({
                ...item.block.program,
                channelName: channel.name,
                channelLogo: channel.logoUrl,
                primaryAction:
                    when === 'now'
                        ? 'live'
                        : item.canCatchUp
                          ? 'timeshift'
                          : null,
                archiveUnavailableNote: when === 'past' && !item.canCatchUp,
            })
            .subscribe((result: EpgItemDialogAction | undefined) => {
                if (result === 'live') {
                    this.activateRow(channel);
                } else if (result === 'timeshift') {
                    this.source.catchUp?.watch(channel, item.block.program);
                }
            });
    }

    watch(channel: EpgGuideChannel, item: TimelineRenderBlock): void {
        this.source.catchUp?.watch(channel, item.block.program);
    }

    private blocksFor(row: number): TimelineRenderBlock[] {
        const channel = this.rows()[row];
        if (!channel) {
            return [];
        }
        return buildGuideRowBlocks(
            this.programsService.programsFor(channel.id),
            {
                axis: this.axis(),
                hourWidthPx: this.zoom(),
                nowMs: this.nowMs(),
                offsetMinutes: this.offsetMinutes(),
                catchUpAvailable: this.catchUpAvailable,
            }
        );
    }
}

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
    Injector,
    OnDestroy,
    output,
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
import { EpgDateNavigationDirection } from '../epg-date';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import { EpgGuideDialogController } from './epg-guide-dialog.controller';
import { EpgGuideKeyboardController } from './epg-guide-keyboard.controller';
import {
    EPG_GUIDE_CHANNEL_COLUMN_PX,
    EpgGuideDensity,
} from './epg-guide-layout.util';
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
import { EpgGuideViewState } from './epg-guide-view-state';
import { EpgGuideViewportController } from './epg-guide-viewport.controller';

/**
 * Multi-channel programme guide. Reads everything from `EPG_GUIDE_SOURCE`;
 * owns the rows, the keyboard focus and the viewport, and delegates the view
 * state (day, zoom, density, filters, clock) and the programme dialogs to
 * their own controllers. Rows are virtualised; the channel column and the
 * ruler are sticky.
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
export class EpgGuideComponent implements OnDestroy {
    private readonly source = inject(EPG_GUIDE_SOURCE);
    private readonly programsService = inject(EpgGuideProgramsService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly dialog = inject(MatDialog);
    private readonly translate = inject(TranslateService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly injector = inject(Injector);

    readonly close = output<void>();
    /**
     * Fired after `source.activate()` for hosts that want to observe a
     * switch made from the guide (analytics, remote-control status); the M3U
     * host reacts through the store instead and leaves it unbound.
     */
    readonly channelActivated = output<string>();

    readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');

    /** Day, zoom, density, filters, clock and the derived day geometry. */
    readonly view = new EpgGuideViewState();
    readonly dayKey = this.view.dayKey;
    readonly zoom = this.view.zoom;
    readonly density = this.view.density;
    readonly onlyWithEpg = this.view.onlyWithEpg;
    readonly filter = this.view.filter;
    readonly rowHeightPx = this.view.rowHeightPx;

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

    readonly totalCount = computed(() => this.source.channels().length);
    readonly rows = computed(() =>
        this.view.filterRows(this.source.channels(), (channelId) =>
            this.programsService.isCovered(channelId)
        )
    );
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
    /**
     * The row that carries the grid's single `tabindex="0"`: the focused one,
     * else the playing one, else the first — so Tab always reaches the grid,
     * and lands where the keyboard left off. A focus left behind by a filter
     * that dropped its row falls back too, or nothing would be tabbable.
     */
    readonly tabbableRow = computed(() => {
        const fallback = Math.max(0, this.activeRowIndex());
        const row = this.focus()?.row ?? fallback;
        return row < this.rows().length ? row : fallback;
    });

    private readonly viewportController = new EpgGuideViewportController({
        viewport: () => this.viewport(),
        rows: () => this.rows(),
        rowHeightPx: () => this.rowHeightPx(),
        channelColumnPx: () => this.channelColumnPx,
        blocksFor: (row) => this.blocksFor(row),
        activeRow: () => this.activeRowIndex(),
        ensureLoaded: (channels) => this.programsService.ensureLoaded(channels),
        setScrollLeft: (left) => this.view.scrollLeft.set(left),
    });

    private readonly dialogs = new EpgGuideDialogController(
        inject(EpgProgrammeDialogService),
        {
            rows: () => this.rows(),
            offsetMinutes: () => this.offsetMinutes(),
            focusRow: (rowIndex) => this.revealRow(rowIndex),
            activate: (channel) => this.activateRow(channel),
            catchUp: () => this.source.catchUp,
        }
    );

    constructor() {
        effect(() => {
            const axis = this.view.axis();
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

    ngOnDestroy(): void {
        this.view.destroy();
        this.search.destroy();
    }

    /**
     * The grid's keys are handled at the document, so the focused cell needs no
     * listener of its own — but it must own the DOM focus, or a screen reader
     * would still announce whatever the user tabbed from. The roving
     * `tabindex="0"` moves with the signal, so the element to focus only exists
     * after the next render.
     */
    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if (!this.keyboard.handle(event)) {
            return;
        }
        event.preventDefault();
        this.viewportController.revealFocus(this.focus());
        afterNextRender(() => this.viewportController.focusRovingTarget(), {
            injector: this.injector,
        });
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

    /** Pointer focus: the roving tabindex follows the mouse, without scrolling. */
    focusCell(row: number, block: number | null): void {
        this.focus.set({ row, block });
    }

    stepDay(direction: EpgDateNavigationDirection): void {
        this.view.stepDay(direction);
        this.focus.set(null);
    }

    jumpNow(animate = true): void {
        this.view.goToToday();
        this.viewportController.scrollToNow(this.view.nowLeftPx(), animate);
    }

    setScope(scopeId: string): void {
        this.source.setScope(scopeId);
        this.focus.set(null);
    }

    setOnlyWithEpg(value: boolean): void {
        this.view.onlyWithEpg.set(value);
    }

    setDensity(value: EpgGuideDensity): void {
        this.view.density.set(value);
    }

    setZoom(value: number): void {
        this.view.setZoom(value);
    }

    setFilter(value: string): void {
        this.view.filter.set(value);
        this.focus.set(null);
    }

    onSearchQueryChange(query: string): void {
        this.search.setQuery(query);
    }

    openSearchResult(hit: EpgGuideSearchHit): void {
        this.dialogs.openSearchResult(hit);
    }

    searchHitStartMs(hit: EpgGuideSearchHit): number {
        return this.dialogs.searchHitStartMs(hit);
    }

    openDetails(
        channel: EpgGuideChannel | undefined,
        item: TimelineRenderBlock | undefined
    ): void {
        this.dialogs.openDetails(channel, item);
    }

    watch(channel: EpgGuideChannel, item: TimelineRenderBlock): void {
        this.dialogs.watch(channel, item);
    }

    /**
     * A double-click arrives as click, click, dblclick, and the store restarts
     * playback on every `activate`, so the row that is already playing is
     * left alone; `commitRow` then only closes.
     */
    activateRow(channel: EpgGuideChannel | undefined): void {
        if (!channel || channel.id === this.activeChannelId()) {
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

    private revealRow(rowIndex: number): void {
        this.focus.set({ row: rowIndex, block: null });
        this.viewportController.revealFocus(this.focus());
    }

    private blocksFor(row: number): TimelineRenderBlock[] {
        const channel = this.rows()[row];
        return channel
            ? this.view.blocksFor(
                  this.programsService.programsFor(channel.id),
                  this.offsetMinutes(),
                  this.catchUpAvailable
              )
            : [];
    }
}

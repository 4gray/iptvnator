import {
    CdkVirtualScrollViewport,
    ScrollingModule,
} from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
    afterNextRender,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    HostListener,
    inject,
    Injector,
    OnDestroy,
    output,
    untracked,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { SettingsStore, injectTranslationTick } from '@iptvnator/services';
import { EpgProgram, epgProviderClockMs } from '@iptvnator/shared/interfaces';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EpgDateNavigationDirection } from '../epg-date';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import { EpgGuideDialogController } from './epg-guide-dialog.controller';
import {
    EpgGuideKeyboardController,
    type EpgGuideFocus,
} from './epg-guide-keyboard.controller';
import {
    EPG_GUIDE_CHANNEL_COLUMN_PX,
    EpgGuideDensity,
    findGuideProgramme,
} from './epg-guide-layout.util';
import {
    EpgGuideProgramsService,
    EpgGuideRowStatus,
} from './epg-guide-programs.service';
import { EpgGuideRowComponent } from './epg-guide-row.component';
import { createEpgGuideRowActivation } from './epg-guide-row-activation';
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
    private readonly changeDetector = inject(ChangeDetectorRef);
    private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly close = output<void>();
    /**
     * Fired after `source.activate()` for hosts that want to observe a
     * switch made from the guide (analytics, remote-control status); the M3U
     * host reacts through the store instead and leaves it unbound.
     */
    readonly channelActivated = output<string>();
    private readonly rowActivation = createEpgGuideRowActivation(
        this.source,
        () => this.rows(),
        (id) => this.channelActivated.emit(id),
        () => {
            if (!this.destroyRef.destroyed) this.close.emit();
        }
    );

    readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');

    /** Day, zoom, density, filters, clock and the derived day geometry. */
    readonly view = new EpgGuideViewState(!this.source.deferredCoverage);
    readonly dayKey = this.view.dayKey;
    readonly zoom = this.view.zoom;
    readonly density = this.view.density;
    readonly onlyWithEpg = this.view.onlyWithEpg;
    readonly filter = this.view.filter;
    readonly rowHeightPx = this.view.rowHeightPx;

    private readonly languageTick = injectTranslationTick();
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
    readonly coverageFilterAvailable = computed(
        () =>
            this.source.deferredCoverage ||
            this.programsService.coverageLoaded()
    );
    readonly coverageStatus = computed(() =>
        this.source.deferredCoverage
            ? this.programsService.coverageStatus()
            : 'idle'
    );
    private readonly search = new EpgGuideSearchController(
        this.source.searchPrograms?.bind(this.source)
    );
    readonly searchEnabled = this.search.enabled;
    readonly searchQuery = this.search.query;
    readonly searchResults = this.search.results;
    readonly searchProgress = this.search.progress;
    readonly searchStatus = this.search.status;
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
        isOwnedTarget: (target) => this.ownsTarget(target),
        play: (row) => this.commitRow(this.rows()[row]),
        details: (row, block) =>
            this.openDetails(this.rows()[row], this.blocksFor(row)[block]),
        revealFocus: () => this.viewportController.revealFocus(this.focus()),
        jumpNow: () => this.jumpNow(),
        stepDay: (direction) => this.stepDay(direction),
        close: () => this.close.emit(),
    });
    readonly focus = this.keyboard.focus;
    /**
     * The channel the roving focus sits on. `rows()` is rebuilt by the filters,
     * by a scope switch and by coverage arriving late, so the focused index
     * alone goes stale — Enter would then play a different channel. Recorded
     * whenever the focus moves and reconciled whenever the rows change.
     */
    private focusedRowId: string | null = null;
    private recordedFocus: EpgGuideFocus | null = null;
    private focusedProgramme?: TimelineRenderBlock['block'];
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
        guideElement: () => this.hostElement.nativeElement,
        viewport: () => this.viewport(),
        rows: () => this.rows(),
        rowHeightPx: () => this.rowHeightPx(),
        channelColumnPx: () => this.channelColumnPx,
        blocksFor: (row) => this.blocksFor(row),
        activeRow: () => this.activeRowIndex(),
        ensureLoaded: (channels) => this.programsService.ensureLoaded(channels),
        setScrollLeft: (left) => this.view.scrollLeft.set(left),
        afterRender: (callback) => this.afterNextGuideRender(callback),
    });

    private readonly dialogs = new EpgGuideDialogController(
        inject(EpgProgrammeDialogService),
        {
            rows: () => this.rows(),
            offsetMinutes: () => this.offsetMinutes(),
            focusRow: (rowIndex) => this.revealRow(rowIndex),
            activate: (channel) => this.activateRow(channel),
            catchUp: () => this.source.catchUp,
            isChannelVisible: this.source.isChannelVisible?.bind(this.source),
        }
    );

    constructor() {
        effect(() => {
            const axis = this.view.axis();
            const offset = this.offsetMinutes();
            const now = this.source.programsExpireAt ? this.view.nowMs() : null;
            untracked(() => {
                this.programsService.setWindow(
                    epgProviderClockMs(axis.startMs, offset),
                    epgProviderClockMs(axis.endMs, offset)
                );
                this.viewportController.loadRenderedRange();
                if (now !== null)
                    this.programsService.refreshExpiredCoverage(now);
            });
        });
        effect(() => {
            const focused = this.focus();
            const moved = focused !== this.recordedFocus;
            if (moved) {
                this.recordedFocus = focused;
                this.focusedRowId = focused
                    ? (untracked(this.rows)[focused.row]?.id ?? null)
                    : null;
            }
            const channelId = this.focusedRowId;
            const block = focused?.block;
            if (!focused || block == null || channelId === null) {
                this.focusedProgramme = undefined;
                return;
            }
            const { row } = focused;
            this.programsFor(channelId);
            untracked(() => {
                if (this.rows()[row]?.id !== channelId) return;
                const blocks = this.blocksFor(row);
                if (moved) {
                    this.focusedProgramme = blocks[block]?.block;
                    if (this.focusedProgramme) return;
                }
                const index = findGuideProgramme(blocks, this.focusedProgramme);
                if (index !== block) {
                    this.focus.set({ row, block: index < 0 ? null : index });
                    this.viewportController.focusRovingTargetOnRow(row);
                }
            });
        });
        effect(() => {
            this.source.revision?.();
            const rows = this.rows();
            untracked(() => {
                this.reconcileFocus(rows);
                this.viewportController.loadRenderedRange();
            });
        });
        if (this.source.revision) {
            effect(() => {
                this.source.revision?.();
                untracked(() => {
                    this.dialogs.checkVisibility();
                    this.search.setQuery(this.search.query());
                });
            });
        }
        effect(() => {
            const viewport = this.viewport();
            if (!viewport) {
                return;
            }
            untracked(() => {
                this.viewportController.watch(viewport, this.destroyRef);
                this.viewportController.whenRowsRendered(
                    viewport,
                    this.destroyRef,
                    () => this.afterNextGuideRender(() => this.jumpNow(false))
                );
            });
        });
    }

    /**
     * Run `callback` after the next render. The callers register from CDK
     * and RxJS callbacks, outside any template event: zone.js used to follow
     * those with a tick, but without it registering a render hook schedules
     * no render, so the guide also marks itself for one.
     */
    private afterNextGuideRender(callback: () => void): void {
        afterNextRender(callback, { injector: this.injector });
        this.changeDetector.markForCheck();
    }

    ngOnDestroy(): void {
        this.dialogs.close();
        this.view.destroy();
        this.search.destroy();
    }

    /**
     * The grid's keys are handled at the document, so the focused cell needs no
     * listener of its own — but it must own the DOM focus, or a screen reader
     * would still announce whatever the user tabbed from. The roving
     * `tabindex="0"` moves with the signal, so the element to focus only exists
     * after the next render — after N's smooth jump, once its row is rendered.
     */
    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if (!this.keyboard.handle(event)) return;
        event.preventDefault();
        this.viewportController.focusRovingTargetOnRow(this.tabbableRow());
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
        const focused = this.focus();
        if (focused?.row === row && focused.block === block) return;
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
        // Search hits carry scope-local row ids, so none may outlive the scope.
        this.search.setQuery('');
    }

    setOnlyWithEpg(value: boolean): void {
        this.view.onlyWithEpg.set(value);
        this.programsService.setCoverageRequested(value);
    }

    setDensity(value: EpgGuideDensity): void {
        this.view.density.set(value);
    }

    setZoom(value: number): void {
        this.view.setZoom(value);
    }

    /**
     * The focus is not cleared here: `reconcileFocus` moves it to the filtered
     * row's new index, or drops it when the filter hid that channel.
     */
    setFilter(value: string): void {
        this.view.filter.set(value);
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

    activateRow(channel: EpgGuideChannel | undefined): void {
        this.rowActivation.activate(channel);
    }

    commitRow(channel: EpgGuideChannel | undefined, allowRetry = true): void {
        this.rowActivation.commit(channel, allowRetry);
    }

    /**
     * Whether a key aimed at `target` belongs to the guide. The listener is on
     * the document, so anything focused elsewhere — the docked player, the
     * header — keeps its own keys; only the guide's own subtree and an
     * unfocused page are ours. `document.body` is the target right after the
     * `G` shortcut opened the guide, and a synthetic event carries no target
     * at all.
     */
    private ownsTarget(target: EventTarget | null): boolean {
        if (target === null) return true;
        if (!(target instanceof Node)) return false;
        return (
            target === document.body ||
            target === document.documentElement ||
            this.hostElement.nativeElement.contains(target)
        );
    }

    /**
     * Keep the roving focus on the channel it was put on rather than on a row
     * number the list has moved under it. If the channel is removed, move to
     * a neighbouring row or the empty viewport. A moved row keeps the same
     * programme if it is still present.
     */
    private reconcileFocus(rows: readonly EpgGuideChannel[]): void {
        const focused = this.focus();
        const channelId = this.focusedRowId;
        if (!focused || channelId === null) {
            return;
        }
        const row = rows.findIndex((channel) => channel.id === channelId);
        if (row === focused.row) return;
        const next = row < 0 ? Math.min(focused.row, rows.length - 1) : row;
        const block =
            row >= 0 && focused.block !== null
                ? findGuideProgramme(this.blocksFor(row), this.focusedProgramme)
                : -1;
        this.focusedRowId = rows[next]?.id ?? null;
        this.recordedFocus =
            next < 0 ? null : { row: next, block: block < 0 ? null : block };
        this.focus.set(this.recordedFocus);
        this.viewportController.restoreFocus(this.recordedFocus);
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

import { computed, effect, signal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EpgDateNavigationDirection,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '../epg-date';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import {
    buildGuideDayAxis,
    buildGuideRowBlocks,
    buildGuideTicks,
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
import { EpgGuideChannel } from './epg-guide-source';

/** How often the guide re-reads the clock; drives "on now" and the now-line. */
const CLOCK_TICK_MS = 60_000;

/**
 * Everything the guide renders itself from: the selected day, the persisted
 * view preferences (zoom, density, "only with EPG"), the channel filter, the
 * clock and the derived day geometry. It owns its own minute timer and the
 * preference-persisting effect, so it must be constructed inside an injection
 * context and released with `destroy()`.
 *
 * Split out of the shell component, which keeps ownership of the data source,
 * keyboard focus and the viewport.
 */
export class EpgGuideViewState {
    private readonly preferences = restoreEpgGuidePreferences();

    readonly dayKey = signal(getTodayEpgDateKey());
    readonly zoom = signal(this.preferences.zoom);
    readonly density = signal<EpgGuideDensity>(this.preferences.density);
    readonly onlyWithEpg = signal(this.preferences.onlyWithEpg);
    readonly filter = signal('');
    readonly nowMs = signal(Date.now());
    /** The viewport's horizontal offset; the ruler and now-line follow it. */
    readonly scrollLeft = signal(0);

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

    private readonly clock = window.setInterval(
        () => this.nowMs.set(Date.now()),
        CLOCK_TICK_MS
    );

    constructor() {
        effect(() =>
            persistEpgGuidePreferences({
                density: this.density(),
                zoom: this.zoom(),
                onlyWithEpg: this.onlyWithEpg(),
            })
        );
    }

    /**
     * Apply the channel filter and the "only with EPG" toggle. `isCovered` is
     * called synchronously, so a signal it reads is tracked by the caller's
     * own computed.
     */
    filterRows(
        channels: readonly EpgGuideChannel[],
        isCovered: (channelId: string) => boolean
    ): EpgGuideChannel[] {
        const needle = this.filter().trim().toLowerCase();
        const onlyWithEpg = this.onlyWithEpg();
        return channels.filter(
            (channel) =>
                (!needle || channel.name.toLowerCase().includes(needle)) &&
                (!onlyWithEpg || isCovered(channel.id))
        );
    }

    setZoom(value: number): void {
        this.zoom.set(clampGuideZoom(value));
    }

    stepDay(direction: EpgDateNavigationDirection): void {
        this.dayKey.set(shiftEpgDateKey(this.dayKey(), direction));
    }

    /** Select today and re-read the clock; the caller does the scrolling. */
    goToToday(): void {
        this.dayKey.set(getTodayEpgDateKey());
        this.nowMs.set(Date.now());
    }

    /**
     * Row-block geometry for the current day, zoom and clock — the same layout
     * the row component renders, needed by keyboard focus and scroll reveal.
     */
    blocksFor(
        programs: readonly EpgProgram[],
        offsetMinutes: number,
        catchUpAvailable: boolean
    ): TimelineRenderBlock[] {
        return buildGuideRowBlocks(programs, {
            axis: this.axis(),
            hourWidthPx: this.zoom(),
            nowMs: this.nowMs(),
            offsetMinutes,
            catchUpAvailable,
        });
    }

    destroy(): void {
        window.clearInterval(this.clock);
    }
}

import { TestBed } from '@angular/core/testing';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getTodayEpgDateKey } from '../epg-date';
import {
    EPG_GUIDE_DENSITY_KEY,
    EPG_GUIDE_ONLY_WITH_EPG_KEY,
    EPG_GUIDE_ZOOM_KEY,
} from './epg-guide-preferences';
import { EpgGuideChannel } from './epg-guide-source';
import { EpgGuideViewState } from './epg-guide-view-state';

const MINUTE_MS = 60_000;

function channel(id: string, name = `Channel ${id}`): EpgGuideChannel {
    return { id, number: 1, name, logoUrl: null, epgKey: id };
}

function create(): EpgGuideViewState {
    return TestBed.runInInjectionContext(() => new EpgGuideViewState());
}

describe('EpgGuideViewState', () => {
    let state: EpgGuideViewState;

    beforeEach(() => {
        localStorage.clear();
        TestBed.configureTestingModule({});
    });

    afterEach(() => {
        state?.destroy();
    });

    it('starts from the persisted preferences and writes changes back', () => {
        localStorage.setItem(EPG_GUIDE_DENSITY_KEY, 'compact');
        localStorage.setItem(EPG_GUIDE_ZOOM_KEY, '300');
        localStorage.setItem(EPG_GUIDE_ONLY_WITH_EPG_KEY, '1');

        state = create();
        expect(state.density()).toBe('compact');
        expect(state.zoom()).toBe(300);
        expect(state.onlyWithEpg()).toBe(true);
        expect(state.rowHeightPx()).toBe(44);

        // Out-of-range zoom is clamped before it is stored.
        state.setZoom(9_999);
        state.density.set('comfortable');
        TestBed.tick();

        expect(state.zoom()).toBe(480);
        expect(localStorage.getItem(EPG_GUIDE_ZOOM_KEY)).toBe('480');
        expect(localStorage.getItem(EPG_GUIDE_DENSITY_KEY)).toBe('comfortable');
    });

    it('filters rows by name and by EPG coverage', () => {
        state = create();
        const rows = [channel('a', 'News HD'), channel('b', 'Sports')];
        const covered = new Set(['b']);
        const isCovered = (id: string) => covered.has(id);

        expect(state.filterRows(rows, isCovered)).toEqual(rows);

        state.filter.set('  NEWS ');
        expect(state.filterRows(rows, isCovered).map((row) => row.id)).toEqual([
            'a',
        ]);

        state.filter.set('');
        state.onlyWithEpg.set(true);
        expect(state.filterRows(rows, isCovered).map((row) => row.id)).toEqual([
            'b',
        ]);
    });

    it('steps the day and returns to today', () => {
        state = create();
        const today = state.dayKey();

        state.stepDay('next');
        expect(state.dayKey()).not.toBe(today);
        expect(state.axis().dayKey).toBe(state.dayKey());

        state.goToToday();
        expect(state.dayKey()).toBe(getTodayEpgDateKey());
    });

    it('hides the now-line once it scrolls behind the channel column', () => {
        state = create();
        const nowX = state.nowLeftPx();
        expect(nowX).not.toBeNull();

        state.scrollLeft.set(Number(nowX) - 10);
        expect(state.nowLineLeftPx()).toBe(10);

        state.scrollLeft.set(Number(nowX) + 10);
        expect(state.nowLineLeftPx()).toBeNull();
    });

    it('lays out a row against the current day, zoom and clock', () => {
        state = create();
        const startMs = state.axis().startMs + 10 * 60 * MINUTE_MS;
        state.nowMs.set(startMs + 5 * MINUTE_MS);
        const program: EpgProgram = {
            start: new Date(startMs).toISOString(),
            stop: new Date(startMs + 30 * MINUTE_MS).toISOString(),
            channel: 'a',
            title: 'On now',
            desc: null,
            category: null,
        };

        const blocks = state.blocksFor([program], 0, false);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].block.when).toBe('now');
        // 10 hours into the day at the default 240px/hour zoom.
        expect(blocks[0].leftPx).toBeCloseTo(2400, 0);
    });

    it('stops its clock when destroyed', () => {
        jest.useFakeTimers();
        try {
            state = create();
            const first = state.nowMs();

            jest.advanceTimersByTime(60_000);
            expect(state.nowMs()).toBeGreaterThan(first);

            const last = state.nowMs();
            state.destroy();
            jest.advanceTimersByTime(120_000);
            expect(state.nowMs()).toBe(last);
        } finally {
            jest.useRealTimers();
        }
    });
});

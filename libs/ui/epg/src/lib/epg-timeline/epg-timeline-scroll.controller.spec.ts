import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    programsFocusKey,
    TimelineScrollController,
} from './epg-timeline-scroll.controller';
import {
    buildTimelineAxis,
    buildTimelineBlocks,
    hasProgramsForDateKey,
    TIMELINE_MINUTE_MS,
} from './epg-timeline.utils';

function programAt(
    startOffsetMin: number,
    durationMin: number,
    title = 'P'
): EpgProgram {
    const start = new Date(Date.now() + startOffsetMin * 60_000);
    const stop = new Date(start.getTime() + durationMin * 60_000);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel: 'ch',
        title,
        desc: null,
        category: null,
    };
}

describe('TimelineScrollController', () => {
    describe('programsFocusKey (channel-change auto-focus identity)', () => {
        const programFor = (channel: string): EpgProgram => ({
            ...programAt(0, 60),
            channel,
        });

        it('is empty for an empty programme set so no focus is attempted', () => {
            expect(programsFocusKey([])).toBe('');
        });

        it('is stable for the same programme set (no re-jump on re-render)', () => {
            const programs = [programFor('a'), programFor('a')];
            expect(programsFocusKey(programs)).toBe(
                programsFocusKey([...programs])
            );
        });

        it('differs when the channel changes (re-focus on channel switch)', () => {
            expect(programsFocusKey([programFor('alpha')])).not.toBe(
                programsFocusKey([programFor('beta')])
            );
        });
    });

    describe('maybeAutoFocus (channel-select centring)', () => {
        let programs: EpgProgram[];
        let controller: TimelineScrollController;
        let scrollSpy: jest.SpyInstance;
        let commitDaySpy: jest.Mock;

        beforeEach(() => {
            programs = [];
            const nowMs = Date.now();
            commitDaySpy = jest.fn();
            controller = new TimelineScrollController({
                ribbon: () => undefined,
                scale: () => 1,
                axis: () => buildTimelineAxis(programs, nowMs),
                blocks: () =>
                    buildTimelineBlocks(
                        programs,
                        buildTimelineAxis(programs, nowMs),
                        nowMs
                    ),
                nowMs: () => nowMs,
                viewDayKey: () => 'today',
                commitDay: commitDaySpy,
                hasProgramsForDay: (dayKey) =>
                    hasProgramsForDateKey(programs, dayKey),
            });
            scrollSpy = jest
                .spyOn(controller, 'scrollToOffset')
                .mockImplementation(() => undefined);
        });

        function focus(
            scroller: HTMLElement | undefined,
            next: EpgProgram[] = programs
        ): void {
            programs = next; // keep axis/blocks accessors in sync with the arg
            controller.maybeAutoFocus(scroller, next);
        }

        it('centres the current programme instantly (no scroll animation)', () => {
            focus({} as HTMLElement, [programAt(0, 120, 'Now')]);

            expect(scrollSpy).toHaveBeenCalledTimes(1);
            const [, frac, smooth] = scrollSpy.mock.calls[0];
            expect(frac).toBe(0.5); // centred in the viewport
            expect(smooth).toBe(false); // instant, no animation
        });

        it('does not re-focus while the same channel stays loaded', () => {
            const p = [programAt(0, 120, 'Now')];
            const scroller = {} as HTMLElement;
            focus(scroller, p);
            focus(scroller, p); // host re-emits same data / now-tick
            expect(scrollSpy).toHaveBeenCalledTimes(1);
        });

        it('restores position when the same channel ribbon remounts (collapse then expand)', () => {
            // Collapse → expand recreates the ribbon as a *new* element at
            // scrollLeft 0, so re-centre the viewed programme — but WITHOUT
            // committing a day, so a user parked on another day is not snapped.
            const p = [programAt(0, 120, 'Now')];
            focus({} as HTMLElement, p); // initial mount → focus #1
            focus(undefined, p); // collapse: ribbon unmounts
            focus({} as HTMLElement, p); // expand: new element → restore
            expect(scrollSpy).toHaveBeenCalledTimes(2);
            expect(commitDaySpy).toHaveBeenCalledTimes(1); // only the initial focus
        });

        it('re-focuses when the channel changes', () => {
            const scroller = {} as HTMLElement;
            focus(scroller, [{ ...programAt(0, 120, 'A'), channel: 'a' }]);
            focus(scroller, [{ ...programAt(0, 120, 'B'), channel: 'b' }]);
            expect(scrollSpy).toHaveBeenCalledTimes(2);
        });

        it('does not focus or snap to today when today has no programmes', () => {
            // Programmes only three days out → today is empty; auto-focus must
            // leave the user's day navigation alone instead of forcing today —
            // even across a collapse/expand remount (a new scroller element).
            const p = [programAt(3 * 1440, 60)];
            focus({} as HTMLElement, p);
            focus({} as HTMLElement, p); // remount → still no focus/snap
            expect(scrollSpy).not.toHaveBeenCalled();
            expect(commitDaySpy).not.toHaveBeenCalled();
        });

        it('skips focus entirely when the ribbon is not mounted', () => {
            focus(undefined, [programAt(0, 120, 'Now')]);
            expect(scrollSpy).not.toHaveBeenCalled();
        });
    });

    describe('onRibbonScroll (gap-day handling)', () => {
        let rafSpy: jest.SpyInstance;
        let nowMs: number;
        let programs: EpgProgram[];
        let scroller: { scrollLeft: number; clientWidth: number };

        beforeEach(() => {
            rafSpy = jest
                .spyOn(window, 'requestAnimationFrame')
                .mockImplementation((cb: FrameRequestCallback) => {
                    cb(0);
                    return 1;
                });
            nowMs = Date.now();
            programs = [programAt(0, 120, 'Now')];
            // Centre the viewport on "now" (today) — a real, in-axis day-key.
            const axis = buildTimelineAxis(programs, nowMs);
            scroller = {
                scrollLeft: (nowMs - axis.startMs) / TIMELINE_MINUTE_MS,
                clientWidth: 0,
            };
        });

        afterEach(() => rafSpy.mockRestore());

        function controllerWith(
            hasProgramsForDay: (dayKey: string) => boolean,
            commitDay: jest.Mock
        ): TimelineScrollController {
            return new TimelineScrollController({
                ribbon: () => scroller as unknown as HTMLElement,
                scale: () => 1,
                axis: () => buildTimelineAxis(programs, nowMs),
                blocks: () =>
                    buildTimelineBlocks(
                        programs,
                        buildTimelineAxis(programs, nowMs),
                        nowMs
                    ),
                nowMs: () => nowMs,
                viewDayKey: () => 'today',
                commitDay,
                hasProgramsForDay,
            });
        }

        it('commits the centred day when it has programmes', () => {
            const commitDay = jest.fn();
            controllerWith(() => true, commitDay).onRibbonScroll();
            expect(commitDay).toHaveBeenCalledTimes(1);
        });

        it('does not commit a gap day (keeps the ribbon mounted mid-scroll)', () => {
            const commitDay = jest.fn();
            controllerWith(() => false, commitDay).onRibbonScroll();
            expect(commitDay).not.toHaveBeenCalled();
        });
    });
});

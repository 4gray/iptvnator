import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    programsFocusKey,
    TimelineScrollController,
} from './epg-timeline-scroll.controller';
import {
    buildTimelineAxis,
    buildTimelineBlocks,
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

        beforeEach(() => {
            programs = [];
            const nowMs = Date.now();
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
                commitDay: () => undefined,
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

        it('does not re-focus the same channel when its ribbon remounts (no snap-back)', () => {
            // Unmount + remount of the SAME channel — e.g. the user navigates from
            // an empty day to a day with programmes — must not re-focus, or it
            // would commit today again and snap the view back to the empty day.
            const p = [programAt(0, 120, 'Now')];
            const scroller = {} as HTMLElement;
            focus(scroller, p); // focus #1
            focus(undefined, p); // ribbon unmounts (empty-day navigation)
            focus(scroller, p); // remount on another day → must NOT re-focus
            expect(scrollSpy).toHaveBeenCalledTimes(1);
        });

        it('re-focuses when the channel changes', () => {
            const scroller = {} as HTMLElement;
            focus(scroller, [{ ...programAt(0, 120, 'A'), channel: 'a' }]);
            focus(scroller, [{ ...programAt(0, 120, 'B'), channel: 'b' }]);
            expect(scrollSpy).toHaveBeenCalledTimes(2);
        });

        it('does not focus or snap to today when today has no programmes', () => {
            // Programmes only three days out → today is empty; auto-focus must
            // leave the user's day navigation alone instead of forcing today.
            focus({} as HTMLElement, [programAt(3 * 1440, 60)]);
            expect(scrollSpy).not.toHaveBeenCalled();
        });

        it('skips focus entirely when the ribbon is not mounted', () => {
            focus(undefined, [programAt(0, 120, 'Now')]);
            expect(scrollSpy).not.toHaveBeenCalled();
        });
    });
});

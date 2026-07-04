import { EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgListScrollController } from './epg-list-scroll.controller';

function programAt(
    startOffsetMin: number,
    durationMin: number,
    channel = 'ch'
): EpgProgram {
    const start = new Date(Date.now() + startOffsetMin * 60_000);
    const stop = new Date(start.getTime() + durationMin * 60_000);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel,
        title: 'P',
        desc: null,
        category: null,
    };
}

describe('EpgListScrollController (channel-select auto-scroll)', () => {
    let controller: EpgListScrollController;
    let scrollSpy: jest.SpyInstance;
    let rafSpy: jest.SpyInstance;
    let hasProgramsToday: jest.Mock;
    let commitToday: jest.Mock;

    beforeEach(() => {
        rafSpy = jest
            .spyOn(window, 'requestAnimationFrame')
            .mockImplementation((cb: FrameRequestCallback) => {
                cb(0);
                return 1;
            });
        hasProgramsToday = jest.fn(() => true);
        commitToday = jest.fn();
        controller = new EpgListScrollController({
            list: () => undefined,
            isViewToday: () => true,
            setNowStripVisible: () => undefined,
            hasProgramsToday,
            commitToday,
        });
        scrollSpy = jest
            .spyOn(controller, 'scrollNowIntoView')
            .mockImplementation(() => undefined);
        jest.spyOn(controller, 'focusNowAfterRender');
        jest.spyOn(controller, 'updateNowStrip').mockImplementation(
            () => undefined
        );
    });

    afterEach(() => {
        rafSpy.mockRestore();
    });

    it('scrolls the now row into view instantly on first load', () => {
        controller.maybeAutoScroll(
            {} as HTMLElement,
            [programAt(0, 120)],
            true,
            'ch'
        );

        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(scrollSpy).toHaveBeenCalledWith(false); // instant, no animation
    });

    it('does not re-scroll while the same set stays loaded (now-tick / rollover)', () => {
        // The 30s tick reclassifies past/now/future at every programme
        // boundary, but the programme SET is unchanged — the viewport must
        // stay put.
        const list = {} as HTMLElement;
        const programs = [programAt(-30, 60), programAt(30, 60)];
        controller.maybeAutoScroll(list, programs, true, 'ch');
        controller.maybeAutoScroll(list, programs, true, 'ch');

        expect(scrollSpy).toHaveBeenCalledTimes(1);
        // The dedup path still refreshes the now-strip — layout can change
        // without scroll events (e.g. the panel grew and nothing scrolls).
        expect(controller.updateNowStrip).toHaveBeenCalled();
    });

    it('restores the now row when the same channel list remounts (collapse then expand)', () => {
        const programs = [programAt(0, 120)];
        controller.maybeAutoScroll({} as HTMLElement, programs, true, 'ch'); // mount
        controller.maybeAutoScroll(undefined, programs, true, 'ch'); // collapsed
        controller.maybeAutoScroll({} as HTMLElement, programs, true, 'ch'); // expand

        expect(scrollSpy).toHaveBeenCalledTimes(2);
    });

    it('re-scrolls when the channel changes', () => {
        const list = {} as HTMLElement;
        controller.maybeAutoScroll(list, [programAt(0, 120, 'a')], true, 'a');
        controller.maybeAutoScroll(list, [programAt(0, 120, 'b')], true, 'b');

        expect(scrollSpy).toHaveBeenCalledTimes(2);
    });

    it('returns to today when a new channel arrives while parked on another day', () => {
        // Channel switch while the user navigated to yesterday: the new set
        // must reset the view to today (when today has data) — otherwise the
        // new channel opens on the stale day (timeline parity).
        controller.maybeAutoScroll(
            {} as HTMLElement,
            [programAt(0, 120, 'b')],
            false,
            'b'
        );

        expect(commitToday).toHaveBeenCalledTimes(1);
        expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves day navigation alone while the set is unchanged', () => {
        // Same channel, user steps to yesterday: same set key → no snap back.
        const list = {} as HTMLElement;
        const programs = [programAt(0, 120)];
        controller.maybeAutoScroll(list, programs, true, 'ch');
        controller.maybeAutoScroll(list, programs, false, 'ch');

        expect(commitToday).not.toHaveBeenCalled();
        expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it('does not take over when the new set has nothing airing today', () => {
        hasProgramsToday.mockReturnValue(false);
        const programs = [programAt(3 * 1440, 60)];
        controller.maybeAutoScroll({} as HTMLElement, programs, false, 'ch');

        expect(commitToday).not.toHaveBeenCalled();
        expect(scrollSpy).not.toHaveBeenCalled();

        // The key was not stored — a later, fuller load retries the focus.
        hasProgramsToday.mockReturnValue(true);
        controller.maybeAutoScroll({} as HTMLElement, programs, true, 'ch');
        expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it('does nothing for an empty programme set', () => {
        controller.maybeAutoScroll({} as HTMLElement, [], true, 'ch');

        expect(scrollSpy).not.toHaveBeenCalled();
        expect(commitToday).not.toHaveBeenCalled();
    });
});

describe('EpgListScrollController (now-strip visibility)', () => {
    function stripStateFor(list: Partial<HTMLElement>): boolean | null {
        let visible: boolean | null = null;
        const controller = new EpgListScrollController({
            list: () => list as HTMLElement,
            isViewToday: () => true,
            setNowStripVisible: (value) => (visible = value),
            hasProgramsToday: () => true,
            commitToday: () => undefined,
        });
        controller.updateNowStrip();
        return visible;
    }

    /** Row 500–560px below the list's viewport top (out of a 0–200 view). */
    const offscreenRow = {
        getBoundingClientRect: () => ({ top: 500, bottom: 560, height: 60 }),
    };

    it('hides the strip when the list does not scroll (nothing can be scrolled away)', () => {
        expect(
            stripStateFor({
                scrollHeight: 200,
                clientHeight: 200,
                getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
                querySelector: () => offscreenRow,
            } as unknown as HTMLElement)
        ).toBe(false);
    });

    it('shows the strip when the on-air row is scrolled out of view', () => {
        expect(
            stripStateFor({
                scrollHeight: 600,
                clientHeight: 200,
                getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
                querySelector: () => offscreenRow,
            } as unknown as HTMLElement)
        ).toBe(true);
    });
});

describe('EpgListScrollController (scroll target maths)', () => {
    it('scrolls relative to the list scroller, not the offset parent', () => {
        // Regression: the rows have no positioned ancestor inside the list, so
        // offsetTop-based maths measured against a far ancestor (including the
        // player above) and scrolled to a wildly wrong position.
        const scrollTo = jest.fn();
        const list = {
            scrollTop: 100,
            scrollTo,
            getBoundingClientRect: () => ({ top: 50 }),
            querySelector: () => ({
                getBoundingClientRect: () => ({ top: 350 }),
            }),
        } as unknown as HTMLElement;
        const controller = new EpgListScrollController({
            list: () => list,
            isViewToday: () => true,
            setNowStripVisible: () => undefined,
            hasProgramsToday: () => true,
            commitToday: () => undefined,
        });

        controller.scrollNowIntoView(false);

        // 100 (current scroll) + (350 − 50) (row offset within view) − 8
        expect(scrollTo).toHaveBeenCalledWith({ top: 392, behavior: 'auto' });
    });
});

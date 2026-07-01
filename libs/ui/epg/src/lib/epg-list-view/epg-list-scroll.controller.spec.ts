import { EpgListScrollController } from './epg-list-scroll.controller';
import { EpgListRow } from './epg-list-view.utils';

function rowAt(when: EpgListRow['when'], key = `${when}-row`): EpgListRow {
    const startMs = Date.now();
    return {
        program: {
            start: new Date(startMs).toISOString(),
            stop: new Date(startMs + 60 * 60_000).toISOString(),
            channel: 'ch',
            title: 'P',
            desc: null,
            category: null,
        },
        key,
        startMs,
        stopMs: startMs + 60 * 60_000,
        when,
        progress: when === 'now' ? 50 : null,
        isActive: false,
        canCatchUp: false,
    };
}

describe('EpgListScrollController (channel-select auto-scroll)', () => {
    let controller: EpgListScrollController;
    let scrollSpy: jest.SpyInstance;
    let rafSpy: jest.SpyInstance;

    beforeEach(() => {
        rafSpy = jest
            .spyOn(window, 'requestAnimationFrame')
            .mockImplementation((cb: FrameRequestCallback) => {
                cb(0);
                return 1;
            });
        controller = new EpgListScrollController({
            list: () => undefined,
            isViewToday: () => true,
            setNowStripVisible: () => undefined,
        });
        scrollSpy = jest
            .spyOn(controller, 'scrollNowIntoView')
            .mockImplementation(() => undefined);
        jest.spyOn(controller, 'updateNowStrip').mockImplementation(
            () => undefined
        );
    });

    afterEach(() => {
        rafSpy.mockRestore();
    });

    it('scrolls the now row into view instantly on first load', () => {
        controller.maybeAutoScroll({} as HTMLElement, [rowAt('now')], true, 'ch');

        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(scrollSpy).toHaveBeenCalledWith(false); // instant, no animation
    });

    it('does not re-scroll while the same channel stays loaded (now-tick / re-emit)', () => {
        const list = {} as HTMLElement;
        const rows = [rowAt('now')];
        controller.maybeAutoScroll(list, rows, true, 'ch');
        controller.maybeAutoScroll(list, rows, true, 'ch');

        expect(scrollSpy).toHaveBeenCalledTimes(1);
        // The dedup path still refreshes the now-strip — layout can change
        // without scroll events (e.g. the panel grew and nothing scrolls).
        expect(controller.updateNowStrip).toHaveBeenCalled();
    });

    it('restores the now row when the same channel list remounts (collapse then expand)', () => {
        const rows = [rowAt('now')];
        controller.maybeAutoScroll({} as HTMLElement, rows, true, 'ch'); // mount
        controller.maybeAutoScroll(undefined, rows, true, 'ch'); // collapsed
        controller.maybeAutoScroll({} as HTMLElement, rows, true, 'ch'); // expand

        expect(scrollSpy).toHaveBeenCalledTimes(2);
    });

    it('does not re-scroll when the on-air programme rolls over within the same set', () => {
        // The 30s tick reclassifies `when` at every programme boundary; the
        // programme SET is unchanged, so the viewport must stay put.
        const list = {} as HTMLElement;
        const a = rowAt('now', 'a');
        const b = {
            ...rowAt('future', 'b'),
            startMs: a.stopMs,
            stopMs: a.stopMs + 3_600_000,
        };
        controller.maybeAutoScroll(list, [a, b], true, 'ch');

        const rolled = [
            { ...a, when: 'past' as const },
            { ...b, when: 'now' as const },
        ];
        controller.maybeAutoScroll(list, rolled, true, 'ch');

        expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it('re-scrolls when the channel changes', () => {
        const list = {} as HTMLElement;
        controller.maybeAutoScroll(list, [rowAt('now', 'a')], true, 'alpha');
        controller.maybeAutoScroll(list, [rowAt('now', 'b')], true, 'beta');

        expect(scrollSpy).toHaveBeenCalledTimes(2);
    });

    it('leaves a non-today day alone (no snap back to now)', () => {
        controller.maybeAutoScroll({} as HTMLElement, [rowAt('now')], false, 'ch');

        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('does nothing without an on-air row or a mounted list', () => {
        controller.maybeAutoScroll({} as HTMLElement, [rowAt('past')], true, 'ch');
        controller.maybeAutoScroll(undefined, [rowAt('now')], true, 'ch');

        expect(scrollSpy).not.toHaveBeenCalled();
    });
});

describe('EpgListScrollController (now-strip visibility)', () => {
    function stripStateFor(list: Partial<HTMLElement>): boolean | null {
        let visible: boolean | null = null;
        const controller = new EpgListScrollController({
            list: () => list as HTMLElement,
            isViewToday: () => true,
            setNowStripVisible: (value) => (visible = value),
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
        });

        controller.scrollNowIntoView(false);

        // 100 (current scroll) + (350 − 50) (row offset within view) − 8
        expect(scrollTo).toHaveBeenCalledWith({ top: 392, behavior: 'auto' });
    });
});

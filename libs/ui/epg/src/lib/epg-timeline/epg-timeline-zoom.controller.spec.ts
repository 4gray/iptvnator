import { TimelineZoomController } from './epg-timeline-zoom.controller';
import {
    TIMELINE_ZOOM_MAX,
    TIMELINE_ZOOM_MIN,
} from './epg-timeline-render.util';

function fakeScroller(clientWidth: number, scrollLeft: number): HTMLElement {
    return {
        clientWidth,
        scrollLeft,
        getBoundingClientRect: () => ({ left: 100 }),
    } as unknown as HTMLElement;
}

describe('TimelineZoomController', () => {
    let scale: number;
    let scroller: HTMLElement | undefined;
    let controller: TimelineZoomController;
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        scale = 2;
        scroller = fakeScroller(600, 1200);
        rafCallbacks = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        controller = new TimelineZoomController({
            ribbon: () => scroller,
            scale: () => scale,
            setScale: (next) => (scale = next),
        });
    });

    afterEach(() => jest.restoreAllMocks());

    function flushFrames(): void {
        for (const cb of rafCallbacks.splice(0)) cb(0);
    }

    it('keeps the viewport centre minute fixed on a programmatic zoom', () => {
        // centre = (1200 + 300) / 2 px/min = 750 min
        controller.zoomTo(4);
        flushFrames();
        expect(scale).toBe(4);
        expect(scroller?.scrollLeft).toBe(750 * 4 - 300);
    });

    it('clamps to the zoom bounds and ignores non-finite input', () => {
        controller.zoomTo(99);
        expect(scale).toBe(TIMELINE_ZOOM_MAX);
        controller.zoomTo(-1);
        expect(scale).toBe(TIMELINE_ZOOM_MIN);
        controller.zoomTo(Number.NaN);
        expect(scale).toBe(TIMELINE_ZOOM_MIN);
    });

    it('does nothing when the clamped scale is unchanged', () => {
        controller.zoomTo(2);
        expect(rafCallbacks).toHaveLength(0);
    });

    it('zooms around the cursor on Ctrl + wheel', () => {
        // cursor 150px into the 600px viewport → anchor 0.25
        const event = new WheelEvent('wheel', {
            deltaY: -100,
            ctrlKey: true,
            clientX: 250,
            cancelable: true,
        });
        controller.onWheel(event);
        flushFrames();
        expect(event.defaultPrevented).toBe(true);
        expect(scale).toBeCloseTo(2 * Math.exp(0.2), 6);
        // minute under the cursor before: (1200 + 150) / 2 = 675
        expect(scroller?.scrollLeft).toBeCloseTo(675 * scale - 150, 6);
    });

    it('leaves plain wheel events alone', () => {
        const event = new WheelEvent('wheel', {
            deltaY: -100,
            cancelable: true,
        });
        controller.onWheel(event);
        expect(event.defaultPrevented).toBe(false);
        expect(scale).toBe(2);
    });

    it('zooms without a rendered ribbon', () => {
        scroller = undefined;
        controller.cycle();
        expect(scale).toBe(3.4);
        expect(rafCallbacks).toHaveLength(0);
    });
});

import {
    COMPACT_LAYOUT_MAX_WIDTH,
    ControlsLayout,
    ROOMY_LAYOUT_MIN_WIDTH,
} from './controls-layout';

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

describe('ControlsLayout', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let callbacks: ResizeCallback[];
    let observed: Element[];
    let disconnected: number;

    function entry(width: number): ResizeObserverEntry {
        return {
            borderBoxSize: [{ inlineSize: width, blockSize: 100 }],
            contentRect: { width } as DOMRectReadOnly,
        } as unknown as ResizeObserverEntry;
    }

    beforeEach(() => {
        callbacks = [];
        observed = [];
        disconnected = 0;
        class FakeResizeObserver {
            constructor(callback: ResizeCallback) {
                callbacks.push(callback);
            }
            observe(target: Element): void {
                observed.push(target);
            }
            disconnect(): void {
                disconnected += 1;
            }
            unobserve(): void {
                /* noop */
            }
        }
        globalThis.ResizeObserver =
            FakeResizeObserver as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        globalThis.ResizeObserver = originalResizeObserver;
    });

    it('starts wide and observes the host', () => {
        const layout = new ControlsLayout();
        const host = document.createElement('div');
        layout.attach(host);

        expect(layout.mode()).toBe('wide');
        expect(observed).toEqual([host]);
    });

    it('switches to compact at the breakpoint and back above it', () => {
        const layout = new ControlsLayout();
        layout.attach(document.createElement('div'));

        callbacks[0]([entry(COMPACT_LAYOUT_MAX_WIDTH)]);
        expect(layout.mode()).toBe('compact');

        callbacks[0]([entry(COMPACT_LAYOUT_MAX_WIDTH + 1)]);
        expect(layout.mode()).toBe('wide');
    });

    it('reports room for chips and the side panel only from the roomy width', () => {
        const layout = new ControlsLayout();
        layout.attach(document.createElement('div'));
        expect(layout.roomy()).toBe(true);

        callbacks[0]([entry(ROOMY_LAYOUT_MIN_WIDTH - 1)]);
        expect(layout.mode()).toBe('wide');
        expect(layout.roomy()).toBe(false);

        callbacks[0]([entry(ROOMY_LAYOUT_MIN_WIDTH)]);
        expect(layout.roomy()).toBe(true);

        callbacks[0]([entry(400)]);
        expect(layout.mode()).toBe('compact');
        expect(layout.roomy()).toBe(false);
    });

    it('uses the last entry of a batch and ignores zero widths', () => {
        const layout = new ControlsLayout();
        layout.attach(document.createElement('div'));

        callbacks[0]([entry(1200), entry(400)]);
        expect(layout.mode()).toBe('compact');

        callbacks[0]([entry(0)]);
        expect(layout.mode()).toBe('compact');
    });

    it('falls back to the content rect when border box sizes are missing', () => {
        const layout = new ControlsLayout();
        layout.attach(document.createElement('div'));

        callbacks[0]([
            {
                contentRect: { width: 300 } as DOMRectReadOnly,
            } as unknown as ResizeObserverEntry,
        ]);
        expect(layout.mode()).toBe('compact');
    });

    it('disconnects on dispose and on re-attach', () => {
        const layout = new ControlsLayout();
        layout.attach(document.createElement('div'));
        layout.attach(document.createElement('div'));
        expect(disconnected).toBe(1);

        layout.dispose();
        expect(disconnected).toBe(2);
    });

    it('stays wide without ResizeObserver support', () => {
        globalThis.ResizeObserver =
            undefined as unknown as typeof ResizeObserver;
        const layout = new ControlsLayout();
        layout.attach(document.createElement('div'));

        expect(layout.mode()).toBe('wide');
        expect(callbacks).toHaveLength(0);
    });
});

import { ListRange } from '@angular/cdk/collections';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { DestroyRef } from '@angular/core';
import { config, Subject } from 'rxjs';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import { EPG_GUIDE_ROW_BUFFER } from './epg-guide-layout.util';
import { EpgGuideChannel } from './epg-guide-source';
import {
    EpgGuideViewportController,
    EpgGuideViewportHost,
} from './epg-guide-viewport.controller';

const CHANNEL_COLUMN_PX = 200;

function channels(count: number): EpgGuideChannel[] {
    return Array.from({ length: count }, (_unused, index) => ({
        id: `c${index}`,
        number: index + 1,
        name: `Channel ${index}`,
        logoUrl: null,
        epgKey: `c${index}`,
    }));
}

function block(leftPx: number, widthPx: number): TimelineRenderBlock {
    return {
        kind: 'block',
        key: `b${leftPx}`,
        block: {
            program: {
                start: '',
                stop: '',
                channel: 'c0',
                title: 't',
                desc: null,
                category: null,
            },
            key: `b${leftPx}`,
            startMs: 0,
            stopMs: 1,
            when: 'now',
            offsetMin: 0,
            durationMin: 1,
        },
        leftPx,
        widthPx,
        tier: 'wide',
        nowFillPercent: 0,
        canCatchUp: false,
    };
}

interface Harness {
    controller: EpgGuideViewportController;
    host: EpgGuideViewportHost;
    viewport: CdkVirtualScrollViewport;
    element: HTMLElement;
    renderedRange$: Subject<ListRange>;
    scrolled$: Subject<Event>;
    destroy: () => void;
    destroyRef: DestroyRef;
    ensureLoaded: jest.Mock;
    setScrollLeft: jest.Mock;
    scrollToIndex: jest.Mock;
    checkViewportSize: jest.Mock;
    scrollTo: jest.Mock;
}

function harness(rowCount = 100): Harness {
    const renderedRange$ = new Subject<ListRange>();
    const scrolled$ = new Subject<Event>();
    const destroyHandlers: Array<() => void> = [];
    const destroyRef = {
        onDestroy: (handler: () => void) => {
            destroyHandlers.push(handler);
            return () => undefined;
        },
    } as unknown as DestroyRef;
    const scrollTo = jest.fn();
    // A real element (a ResizeObserver, where one exists, only accepts one),
    // with the layout properties jsdom always reports as 0 shadowed.
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: 1000 });
    Object.defineProperty(element, 'clientHeight', { value: 400 });
    Object.defineProperty(element, 'scrollLeft', { value: 0, writable: true });
    element.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const scrollToIndex = jest.fn();
    const checkViewportSize = jest.fn();
    const viewport = {
        elementRef: { nativeElement: element },
        renderedRangeStream: renderedRange$.asObservable(),
        elementScrolled: () => scrolled$.asObservable(),
        measureScrollOffset: jest.fn(() => 0),
        scrollToIndex,
        checkViewportSize,
    } as unknown as CdkVirtualScrollViewport;
    const ensureLoaded = jest.fn();
    const setScrollLeft = jest.fn();
    const rows = channels(rowCount);
    const host: EpgGuideViewportHost = {
        viewport: () => viewport,
        rows: () => rows,
        rowHeightPx: () => 60,
        channelColumnPx: () => CHANNEL_COLUMN_PX,
        blocksFor: () => [block(0, 100), block(2000, 300)],
        activeRow: () => 40,
        ensureLoaded,
        setScrollLeft,
        afterRender: (callback) => callback(),
    };
    return {
        controller: new EpgGuideViewportController(host),
        host,
        viewport,
        element,
        renderedRange$,
        scrolled$,
        destroy: () => destroyHandlers.forEach((handler) => handler()),
        destroyRef,
        ensureLoaded,
        setScrollLeft,
        scrollToIndex,
        checkViewportSize,
        scrollTo,
    };
}

describe('EpgGuideViewportController', () => {
    it('requests the first screenful before the viewport reports a range', () => {
        const { controller, ensureLoaded } = harness();
        controller.loadRenderedRange();
        // 30 initial rows, extended by the buffer, clamped to the row count.
        expect(ensureLoaded.mock.calls[0][0]).toHaveLength(
            30 + EPG_GUIDE_ROW_BUFFER
        );
        expect(ensureLoaded.mock.calls[0][0][0].id).toBe('c0');
    });

    it('buffers the rendered range on both sides and clamps at the ends', () => {
        const test = harness(100);
        test.controller.watch(test.viewport, test.destroyRef);

        test.renderedRange$.next({ start: 50, end: 60 });
        const middle = test.ensureLoaded.mock.calls.at(-1)?.[0];
        expect(middle[0].id).toBe(`c${50 - EPG_GUIDE_ROW_BUFFER}`);
        expect(middle).toHaveLength(10 + 2 * EPG_GUIDE_ROW_BUFFER);

        test.renderedRange$.next({ start: 0, end: 95 });
        const edges = test.ensureLoaded.mock.calls.at(-1)?.[0];
        expect(edges[0].id).toBe('c0');
        expect(edges).toHaveLength(100);
    });

    it('mirrors the viewport scroll offset to the host', () => {
        const test = harness();
        test.controller.watch(test.viewport, test.destroyRef);

        test.element.scrollLeft = 640;
        test.scrolled$.next(new Event('scroll'));

        expect(test.setScrollLeft).toHaveBeenCalledWith(640);
    });

    it('stops mirroring and loading once the host is destroyed', () => {
        const test = harness();
        test.controller.watch(test.viewport, test.destroyRef);
        test.destroy();
        test.ensureLoaded.mockClear();

        test.scrolled$.next(new Event('scroll'));
        test.renderedRange$.next({ start: 10, end: 20 });

        expect(test.setScrollLeft).not.toHaveBeenCalled();
        expect(test.ensureLoaded).not.toHaveBeenCalled();
    });

    it('scrolls the lane and the playing row to now in one call, and does nothing off-day', () => {
        const test = harness();
        test.controller.scrollToNow(900, true);
        // 1000 - 200 visible, a third of it kept to the left of the line; the
        // playing row 40 keeps three rows above it. A second, vertical smooth
        // scroll would cancel the horizontal one in Chromium (#1733).
        expect(test.scrollTo).toHaveBeenCalledTimes(1);
        expect(test.scrollTo).toHaveBeenCalledWith({
            left: 900 - 800 / 3,
            top: 37 * 60,
            behavior: 'smooth',
        });
        expect(test.scrollToIndex).not.toHaveBeenCalled();

        test.scrollTo.mockClear();
        test.controller.scrollToNow(null, false);
        expect(test.scrollTo).not.toHaveBeenCalled();
    });

    it('scrolls only the lane to now when no channel is playing', () => {
        const test = harness();
        test.host.activeRow = () => -1;
        test.controller.scrollToNow(900, false);
        expect(test.scrollTo).toHaveBeenCalledWith({
            left: 900 - 800 / 3,
            behavior: 'auto',
        });
    });

    it('waits for the first rendered rows before the initial jump, once', () => {
        const test = harness();
        const callback = jest.fn();
        test.controller.whenRowsRendered(
            test.viewport,
            test.destroyRef,
            callback
        );

        // The CDK reports an empty range before it has measured itself.
        test.renderedRange$.next({ start: 0, end: 0 });
        expect(callback).not.toHaveBeenCalled();

        test.renderedRange$.next({ start: 0, end: 12 });
        test.renderedRange$.next({ start: 4, end: 16 });
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('closes cleanly when the viewport completes without ever rendering rows', async () => {
        const test = harness();
        const callback = jest.fn();
        const onUnhandledError = jest.fn();
        const previous = config.onUnhandledError;
        config.onUnhandledError = onUnhandledError;
        try {
            test.controller.whenRowsRendered(
                test.viewport,
                test.destroyRef,
                callback
            );
            // An empty scope: the CDK only ever reports an empty range, then
            // completes the stream when the guide closes.
            test.renderedRange$.next({ start: 0, end: 0 });
            test.renderedRange$.complete();
            // RxJS reports unhandled errors from a timeout.
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            config.onUnhandledError = previous;
        }

        expect(onUnhandledError).not.toHaveBeenCalled();
        expect(callback).not.toHaveBeenCalled();
    });

    it('drops the initial jump when the host is destroyed first', () => {
        const test = harness();
        const callback = jest.fn();
        test.controller.whenRowsRendered(
            test.viewport,
            test.destroyRef,
            callback
        );
        test.destroy();

        test.renderedRange$.next({ start: 0, end: 12 });
        expect(callback).not.toHaveBeenCalled();
    });

    it('gives the DOM focus to the cell holding the roving tabindex', () => {
        const test = harness();
        const passive = document.createElement('div');
        passive.setAttribute('data-epg-guide-grid', '');
        passive.tabIndex = -1;
        const roving = document.createElement('div');
        roving.setAttribute('data-epg-guide-grid', '');
        roving.tabIndex = 0;
        test.element.append(passive, roving);
        document.body.append(test.element);

        test.controller.focusRovingTarget();
        expect(document.activeElement).toBe(roving);

        // Nothing tabbable (a row scrolled out of the rendered range): the
        // current focus is left alone rather than reset.
        roving.remove();
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        test.controller.focusRovingTarget();
        expect(document.activeElement).toBe(outside);

        outside.remove();
        test.element.remove();
    });

    it('focuses the roving target only once its row is rendered', () => {
        const test = harness();
        test.controller.watch(test.viewport, test.destroyRef);
        test.renderedRange$.next({ start: 0, end: 20 });
        const cell = document.createElement('button');
        cell.setAttribute('data-epg-guide-grid', '');
        cell.tabIndex = 0;
        const focus = jest.spyOn(cell, 'focus');

        // A smooth jump to row 40: the row is not rendered yet.
        test.controller.focusRovingTargetOnRow(40);
        expect(focus).not.toHaveBeenCalled();
        test.renderedRange$.next({ start: 20, end: 35 });
        expect(focus).not.toHaveBeenCalled();
        test.element.appendChild(cell);
        test.renderedRange$.next({ start: 30, end: 50 });
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });

        // Already rendered: focused after the next render, and only once.
        focus.mockClear();
        test.controller.focusRovingTargetOnRow(35);
        expect(focus).toHaveBeenCalledTimes(1);
        test.renderedRange$.next({ start: 30, end: 60 });
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('drops a pending roving focus when a newer one is requested', () => {
        const test = harness();
        test.controller.watch(test.viewport, test.destroyRef);
        test.renderedRange$.next({ start: 0, end: 20 });
        const cell = document.createElement('button');
        cell.setAttribute('data-epg-guide-grid', '');
        cell.tabIndex = 0;
        test.element.appendChild(cell);
        const focus = jest.spyOn(cell, 'focus');

        test.controller.focusRovingTargetOnRow(40);
        test.controller.focusRovingTargetOnRow(60);
        focus.mockClear();
        test.renderedRange$.next({ start: 30, end: 50 });
        expect(focus).not.toHaveBeenCalled();
        test.renderedRange$.next({ start: 50, end: 70 });
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('does not take the focus from a control outside the grid', () => {
        const test = harness();
        const cell = document.createElement('button');
        cell.setAttribute('data-epg-guide-grid', '');
        cell.tabIndex = 0;
        test.element.appendChild(cell);
        const focus = jest.spyOn(cell, 'focus');
        const field = document.createElement('input');
        document.body.appendChild(field);
        field.focus();
        try {
            test.controller.focusRovingTarget();
            expect(focus).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(field);
        } finally {
            field.remove();
        }
    });

    it('reveals the focused row and block, and ignores a null focus', () => {
        const test = harness();
        test.controller.revealFocus({ row: 40, block: 1 });
        expect(test.scrollToIndex).toHaveBeenCalledWith(38);
        expect(test.scrollTo).toHaveBeenCalledWith({
            left: 2000 - 40,
            behavior: 'smooth',
        });

        test.scrollTo.mockClear();
        test.controller.revealFocus({ row: 40, block: 0 });
        expect(test.scrollTo).not.toHaveBeenCalled();

        test.scrollToIndex.mockClear();
        test.controller.revealFocus(null);
        expect(test.scrollToIndex).not.toHaveBeenCalled();
    });
});

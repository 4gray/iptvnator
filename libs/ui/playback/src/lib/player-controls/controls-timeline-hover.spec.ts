import { signal } from '@angular/core';
import {
    ControlsTimelineHover,
    projectPointerToSeconds,
} from './controls-timeline-hover';

describe('projectPointerToSeconds', () => {
    const rect = { left: 100, width: 200 };

    it('maps the pointer across the bar to the duration', () => {
        expect(projectPointerToSeconds(100, rect, 600)).toBe(0);
        expect(projectPointerToSeconds(200, rect, 600)).toBe(300);
        expect(projectPointerToSeconds(300, rect, 600)).toBe(600);
    });

    it('clamps positions outside the bar', () => {
        expect(projectPointerToSeconds(20, rect, 600)).toBe(0);
        expect(projectPointerToSeconds(999, rect, 600)).toBe(600);
    });

    it('returns null without a usable bar or duration', () => {
        expect(projectPointerToSeconds(150, { left: 0, width: 0 }, 600)).toBe(
            null
        );
        expect(projectPointerToSeconds(150, rect, 0)).toBeNull();
        expect(projectPointerToSeconds(Number.NaN, rect, 600)).toBeNull();
    });
});

describe('ControlsTimelineHover', () => {
    it('projects hover into a live buffer with a nonzero start', () => {
        const start = signal(60);
        const hover = new ControlsTimelineHover({
            start,
            duration: signal(90),
            interactive: signal(true),
        });
        const bar = document.createElement('div');
        bar.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
        hover.move({ clientX: 200, pointerType: 'mouse' } as PointerEvent, bar);
        expect(hover.seconds()).toBe(75);
        expect(hover.percent()).toBe(50);
        start.set(70);
        hover.move({ clientX: 200, pointerType: 'mouse' } as PointerEvent, bar);
        expect(hover.seconds()).toBe(80);
        expect(hover.percent()).toBe(50);
    });
    function createHover(duration = 600, interactive = true) {
        const durationSignal = signal(duration);
        const interactiveSignal = signal(interactive);
        const hover = new ControlsTimelineHover({
            duration: durationSignal,
            interactive: interactiveSignal,
        });
        const bar = document.createElement('div');
        bar.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
        return { hover, bar, durationSignal, interactiveSignal };
    }

    function pointer(clientX: number, pointerType = 'mouse'): PointerEvent {
        return { clientX, pointerType } as PointerEvent;
    }

    it('reports the hovered time, percent and label', () => {
        const { hover, bar } = createHover();

        hover.move(pointer(100), bar);

        expect(hover.seconds()).toBe(150);
        expect(hover.percent()).toBe(25);
        expect(hover.label()).toBe('2:30');
    });

    it('clears on leave', () => {
        const { hover, bar } = createHover();
        hover.move(pointer(100), bar);

        hover.clear();

        expect(hover.seconds()).toBeNull();
        expect(hover.percent()).toBeNull();
        expect(hover.label()).toBeNull();
    });

    it('ignores touch pointers and non-interactive timelines', () => {
        const { hover, bar, interactiveSignal } = createHover();

        hover.move(pointer(100, 'touch'), bar);
        expect(hover.seconds()).toBeNull();

        interactiveSignal.set(false);
        hover.move(pointer(100), bar);
        expect(hover.seconds()).toBeNull();
    });

    it('reads the bar from the event target when none is passed', () => {
        const { hover, bar } = createHover();

        hover.move({ ...pointer(200), currentTarget: bar } as PointerEvent);
        expect(hover.seconds()).toBe(300);

        hover.move({ ...pointer(200), currentTarget: null } as PointerEvent);
        expect(hover.seconds()).toBeNull();
    });

    it('drops a stale hover once the duration disappears', () => {
        const { hover, bar, durationSignal } = createHover();
        hover.move(pointer(100), bar);

        durationSignal.set(0);

        expect(hover.percent()).toBeNull();
    });
});

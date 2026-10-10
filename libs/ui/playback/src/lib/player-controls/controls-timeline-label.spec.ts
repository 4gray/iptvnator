import { signal } from '@angular/core';
import { buildCatchupTimelineSegments } from './catchup-timeline-segments';
import {
    ControlsTimelineLabel,
    TIMELINE_LABEL_EDGE_PX,
    clampTimelineLabelLeft,
    projectPointerToSeconds,
} from './controls-timeline-label';
import { normalizeTimelineSegments } from './controls-timeline-segments';
import type { PlayerTimelineSegment } from './player-controls.model';

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

describe('clampTimelineLabelLeft', () => {
    // A 1280px player whose bar runs from x=90 to x=1190: the current and
    // remaining times flank it.
    const player = { left: 0, right: 1280 };
    const bar = { left: 90, width: 1100 };
    const edge = TIMELINE_LABEL_EDGE_PX;

    it('centres the label on its anchor when it fits', () => {
        // Anchor at 550px into the bar; a 200px label starts 100px before.
        expect(clampTimelineLabelLeft(50, 200, bar, player)).toBe(450);
    });

    it('lets the label pass the bar ends but not the player edges', () => {
        // At the bar's start the centred label would begin at -100px (bar
        // coordinates), i.e. 10px left of the player: pinned to its edge.
        expect(clampTimelineLabelLeft(0, 200, bar, player)).toBe(
            -bar.left + edge
        );
        // A narrower label centred there still fits past the bar's start.
        expect(clampTimelineLabelLeft(0, 60, bar, player)).toBe(-30);
        // At the bar's end the right edge is pinned to the player's.
        const left = clampTimelineLabelLeft(100, 300, bar, player);
        expect(bar.left + left + 300).toBe(player.right - edge);
    });

    it('keeps a measured 120-character title label inside narrow players', () => {
        // The title caps at min(320px, 60cqw); with the time and padding an
        // 800px player's label measures about 390px.
        const narrow = { left: 0, right: 800 };
        const narrowBar = { left: 70, width: 660 };
        for (const percent of [0, 3, 50, 97, 100]) {
            const left = clampTimelineLabelLeft(percent, 390, narrowBar, narrow);
            const start = narrowBar.left + left;
            expect(start).toBeGreaterThanOrEqual(narrow.left + edge);
            expect(start + 390).toBeLessThanOrEqual(narrow.right - edge);
        }
    });

    it('starts a label wider than the player at its left edge', () => {
        const tiny = { left: 0, right: 200 };
        expect(
            clampTimelineLabelLeft(50, 400, { left: 40, width: 120 }, tiny)
        ).toBe(-40 + edge);
    });
});

describe('ControlsTimelineLabel', () => {
    function createLabel(options: {
        duration?: number;
        interactive?: boolean;
        segments?: readonly PlayerTimelineSegment[] | null;
    } = {}) {
        const duration = signal(options.duration ?? 600);
        const interactive = signal(options.interactive ?? true);
        const value = signal(0);
        const scrubbing = signal(false);
        const label = new ControlsTimelineLabel({
            duration,
            interactive,
            segments: signal(
                normalizeTimelineSegments(options.segments, duration())
            ),
            value,
            scrubbing,
        });
        const bar = document.createElement('div');
        bar.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect;
        return { label, bar, duration, interactive, value, scrubbing };
    }

    function pointer(clientX: number, pointerType = 'mouse'): PointerEvent {
        return { clientX, pointerType } as PointerEvent;
    }

    /** A focus event whose target answers `:focus-visible` as given. */
    function focusEvent(visible: boolean): FocusEvent {
        const slider = document.createElement('input');
        Object.defineProperty(slider, 'matches', {
            value: (selector: string) =>
                selector === ':focus-visible' ? visible : false,
        });
        return { target: slider } as unknown as FocusEvent;
    }

    function key(name: string): KeyboardEvent {
        return { key: name } as KeyboardEvent;
    }

    it('reports the hovered time, percent, marker and text', () => {
        const { label, bar } = createLabel();

        label.move(pointer(100), bar);

        expect(label.seconds()).toBe(150);
        expect(label.percent()).toBe(25);
        expect(label.markerPercent()).toBe(25);
        expect(label.text()).toEqual({ title: null, time: '2:30' });
    });

    it('clears on leave', () => {
        const { label, bar } = createLabel();
        label.move(pointer(100), bar);

        label.clear();

        expect(label.seconds()).toBeNull();
        expect(label.percent()).toBeNull();
        expect(label.text()).toBeNull();
    });

    it('ignores touch hovers and non-interactive timelines', () => {
        const { label, bar, interactive } = createLabel();

        label.move(pointer(100, 'touch'), bar);
        expect(label.seconds()).toBeNull();

        interactive.set(false);
        label.move(pointer(100), bar);
        expect(label.seconds()).toBeNull();
    });

    it('reads the bar from the event target when none is passed', () => {
        const { label, bar } = createLabel();

        label.move({ ...pointer(200), currentTarget: bar } as PointerEvent);
        expect(label.seconds()).toBe(300);

        label.move({ ...pointer(200), currentTarget: null } as PointerEvent);
        expect(label.seconds()).toBeNull();
    });

    it('drops a stale label once the duration disappears', () => {
        const { label, bar, duration } = createLabel();
        label.move(pointer(100), bar);

        duration.set(0);

        expect(label.percent()).toBeNull();
        expect(label.text()).toBeNull();
    });

    describe('keyboard', () => {
        it('labels the slider value on keyboard focus, without a marker', () => {
            const { label, value } = createLabel();
            value.set(90);

            label.focus(focusEvent(true));

            expect(label.percent()).toBe(15);
            expect(label.text()).toEqual({ title: null, time: '1:30' });
            expect(label.markerPercent()).toBeNull();

            value.set(95);
            expect(label.text()?.time).toBe('1:35');

            label.blur();
            expect(label.text()).toBeNull();
        });

        it('stays hidden on pointer focus until a seek key arrives', () => {
            const { label, value } = createLabel();
            value.set(60);

            label.focus(focusEvent(false));
            expect(label.text()).toBeNull();

            label.keydown(key('Tab'));
            expect(label.text()).toBeNull();

            label.keydown(key('ArrowRight'));
            expect(label.text()?.time).toBe('1:00');
        });

        it('treats focus as visible where :focus-visible is unsupported', () => {
            const { label } = createLabel();
            const slider = document.createElement('input');
            Object.defineProperty(slider, 'matches', {
                value: () => {
                    throw new SyntaxError('unknown pseudo-class');
                },
            });

            label.focus({ target: slider } as unknown as FocusEvent);

            expect(label.keyboard()).toBe(true);
        });

        it('lets a hovering pointer take over, then returns to the value', () => {
            const { label, bar, value } = createLabel();
            value.set(60);
            label.keydown(key('End'));

            label.move(pointer(200), bar);
            expect(label.text()?.time).toBe('5:00');

            label.clear();
            expect(label.text()?.time).toBe('1:00');
        });

        it('never labels a non-interactive timeline', () => {
            const { label, interactive } = createLabel();
            label.keydown(key('ArrowLeft'));

            interactive.set(false);

            expect(label.text()).toBeNull();
        });
    });

    it('follows a drag preview, which is how touch users see it', () => {
        const { label, bar, value, scrubbing } = createLabel();
        label.move(pointer(100, 'touch'), bar);
        value.set(300);

        scrubbing.set(true);
        expect(label.text()?.time).toBe('5:00');
        expect(label.markerPercent()).toBeNull();

        scrubbing.set(false);
        expect(label.text()).toBeNull();
    });

    describe('segment titles', () => {
        it('names catch-up programmes', () => {
            // A 60-minute archive window holding two programmes.
            const programme = (title: string, start: number, stop: number) => ({
                title,
                start: '',
                stop: '',
                startTimestamp: start,
                stopTimestamp: stop,
            });
            const active = programme('Morning Report', 10_000, 11_800);
            const segments = buildCatchupTimelineSegments(
                [active, programme('Weather', 11_800, 13_600)],
                active,
                13_600
            );
            const { label, value } = createLabel({
                duration: 3600,
                segments,
            });
            label.keydown(key('ArrowRight'));

            value.set(600);
            expect(label.text()).toEqual({
                title: 'Morning Report',
                time: '10:00',
            });
            value.set(1800);
            expect(label.text()?.title).toBe('Weather');
        });

        it('names file chapters and leaves untitled ones to the time', () => {
            // Chapters as Embedded MPV reports them: each runs to the next
            // one's start, the last to the end; an untitled one has no name.
            const { label, value } = createLabel({
                duration: 600,
                segments: [
                    { startSeconds: 0, endSeconds: 90, title: 'Opening' },
                    { startSeconds: 90, endSeconds: 480, title: null },
                    { startSeconds: 480, endSeconds: 600, title: 'Credits' },
                ],
            });
            label.keydown(key('Home'));

            value.set(30);
            expect(label.text()).toEqual({ title: 'Opening', time: '0:30' });
            value.set(200);
            expect(label.text()).toEqual({ title: null, time: '3:20' });
            value.set(600);
            expect(label.text()?.title).toBe('Credits');
        });
    });
});

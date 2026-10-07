import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { EpgTimelineComponent } from './epg-timeline.component';
import {
    marksInRange,
    renderItemsInRange,
    TIMELINE_WINDOW_BUFFER_VIEWPORTS,
    timelineWindowRange,
    viewportFromScroller,
    viewportNeedsWindow,
} from './epg-timeline-window.controller';
import {
    TIMELINE_MINUTE_MS,
    TimelineRenderItem,
    TimelineTick,
} from './epg-timeline.utils';

const SLOT_MIN = 30;

function programAt(startOffsetMin: number, title: string): EpgProgram {
    const start = new Date(Date.now() + startOffsetMin * TIMELINE_MINUTE_MS);
    const stop = new Date(start.getTime() + SLOT_MIN * TIMELINE_MINUTE_MS);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel: 'ch',
        title,
        desc: null,
        category: null,
    };
}

/**
 * The Xtream mock's shape: 240 half-hour slots, two days back, three ahead.
 * Now falls in the middle of slot 96.
 */
function mockSchedule(): EpgProgram[] {
    const firstOffsetMin = -2 * 24 * 60 - SLOT_MIN / 2;
    return Array.from({ length: 240 }, (_, index) =>
        programAt(firstOffsetMin + index * SLOT_MIN, `Slot ${index}`)
    );
}

function item(key: string, leftPx: number, widthPx: number) {
    return { kind: 'group', key, leftPx, widthPx } as TimelineRenderItem;
}

describe('timeline window helpers', () => {
    const axis = { startMs: 0, endMs: 3 * 24 * 60 * TIMELINE_MINUTE_MS };

    it('spans the viewport plus the buffer on both sides of the centre', () => {
        const range = timelineWindowRange(
            { centreMs: 1000 * TIMELINE_MINUTE_MS, widthPx: 800 },
            axis,
            2
        );
        const half = 800 * (0.5 + TIMELINE_WINDOW_BUFFER_VIEWPORTS);
        expect(range).toEqual({ startPx: 2000 - half, endPx: 2000 + half });
    });

    it('keeps the items overlapping the range, in order', () => {
        const items = [
            item('before', 0, 90),
            item('touching', 50, 60),
            item('inside', 200, 50),
            item('straddling', 280, 100),
            item('after', 400, 50),
        ];
        const kept = renderItemsInRange(items, { startPx: 100, endPx: 300 });
        expect(kept.map((entry) => entry.key)).toEqual([
            'touching',
            'inside',
            'straddling',
        ]);
    });

    it('keeps a mark whose label can still reach into the range', () => {
        const marks: TimelineTick[] = [
            { ms: 1, offsetMin: 0 },
            { ms: 2, offsetMin: 400 },
            { ms: 3, offsetMin: 600 },
            { ms: 4, offsetMin: 1200 },
        ];
        const kept = marksInRange(marks, 1, { startPx: 500, endPx: 1000 });
        expect(kept.map((mark) => mark.ms)).toEqual([2, 3]);
    });

    it('measures the centre of the scrolled viewport in epoch time', () => {
        expect(viewportFromScroller(1000, 400, axis, 2)).toEqual({
            centreMs: 600 * TIMELINE_MINUTE_MS,
            widthPx: 400,
        });
    });

    it('re-windows after a quarter-viewport move or a wider ribbon only', () => {
        const current = { centreMs: 0, widthPx: 800 };
        const at = (px: number, widthPx = 800) => ({
            centreMs: px * TIMELINE_MINUTE_MS,
            widthPx,
        });
        expect(viewportNeedsWindow(current, at(199), 1)).toBe(false);
        expect(viewportNeedsWindow(current, at(-200), 1)).toBe(true);
        expect(viewportNeedsWindow(current, at(0, 600), 1)).toBe(false);
        expect(viewportNeedsWindow(current, at(0, 900), 1)).toBe(true);
    });
});

describe('EpgTimelineComponent ribbon windowing', () => {
    let fixture: ComponentFixture<EpgTimelineComponent>;
    let component: EpgTimelineComponent;
    let ribbonWidth: number;
    let frames: FrameRequestCallback[];

    function flushFrames(): void {
        while (frames.length > 0) {
            frames.splice(0).forEach((callback) => callback(0));
            fixture.detectChanges();
        }
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [EpgTimelineComponent],
            providers: [
                {
                    provide: MatDialog,
                    useValue: {
                        open: () => ({ afterClosed: () => of(undefined) }),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        onTranslationChange: new BehaviorSubject(null),
                        onDefaultLangChange: new BehaviorSubject(null),
                        get: (key: string) => of(key),
                        instant: (key: string) => key,
                    },
                },
            ],
        });
        ribbonWidth = 800;
        jest.spyOn(
            HTMLElement.prototype,
            'clientWidth',
            'get'
        ).mockImplementation(() => ribbonWidth);
        // Queue frame callbacks; `flushFrames` runs them like a frame would.
        frames = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback) => frames.push(callback)
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            () => undefined
        );
        HTMLElement.prototype.scrollTo = function (
            this: HTMLElement,
            options?: ScrollToOptions | number
        ) {
            if (typeof options === 'object' && options.left !== undefined) {
                this.scrollLeft = options.left;
            }
        } as HTMLElement['scrollTo'];

        fixture = TestBed.createComponent(EpgTimelineComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function render(programs: EpgProgram[]): void {
        fixture.componentRef.setInput('programs', programs);
        fixture.detectChanges();
        flushFrames();
    }

    function ribbon(): HTMLElement {
        return fixture.nativeElement.querySelector('.epg-timeline__ribbon');
    }

    function renderedTitles(): string[] {
        return Array.from(
            fixture.nativeElement.querySelectorAll(
                '.epg-timeline__block-title'
            ) as NodeListOf<HTMLElement>
        ).map((title) => title.textContent?.trim() ?? '');
    }

    function scrollRibbonTo(left: number): void {
        ribbon().scrollLeft = left;
        ribbon().dispatchEvent(new Event('scroll'));
        flushFrames();
    }

    function blockLeftPx(title: string): number {
        const block = component
            .renderItems()
            .find(
                (entry) =>
                    entry.kind === 'block' &&
                    entry.block.program.title === title
            );
        if (!block) {
            throw new Error(`no render item for ${title}`);
        }
        return block.leftPx;
    }

    it('renders the programmes around now, not the whole schedule', () => {
        render(mockSchedule());

        const titles = renderedTitles();
        expect(component.renderItems()).toHaveLength(240);
        expect(titles.length).toBeGreaterThan(0);
        // Twice the ribbon width (800px) of 52.5px blocks, plus the edges.
        expect(titles.length).toBeLessThanOrEqual(34);
        expect(titles).toContain('Slot 96');
        expect(titles).not.toContain('Slot 0');
        expect(titles).not.toContain('Slot 239');
        // The track keeps the width of the whole schedule.
        const track = fixture.nativeElement.querySelector(
            'app-epg-timeline-track'
        ) as HTMLElement;
        expect(track.style.width).toBe(`${component.trackWidthPx()}px`);
    });

    it('keeps the on-now block, including its live state', () => {
        render(mockSchedule());

        const nowTitle = fixture.nativeElement.querySelector(
            '.epg-timeline__block.is-now .epg-timeline__block-title'
        ) as HTMLElement;
        expect(nowTitle.textContent?.trim()).toBe('Slot 96');
    });

    it('renders the blocks of a range the user scrolls to', () => {
        render(mockSchedule());

        scrollRibbonTo(blockLeftPx('Slot 230') - ribbonWidth / 2);

        const titles = renderedTitles();
        expect(titles).toContain('Slot 230');
        expect(titles).toContain('Slot 239');
        expect(titles).not.toContain('Slot 96');
    });

    /** Render items overlapping the ribbon's px range at the current scale. */
    function itemsIn(leftPx: number, widthPx: number): string[] {
        return component
            .renderItems()
            .filter(
                (entry) =>
                    entry.leftPx + entry.widthPx >= leftPx &&
                    entry.leftPx <= leftPx + widthPx
            )
            .map((entry) => entry.key);
    }

    // The anchored scroll lands on a later frame; the window must already
    // cover what the ribbon will show at the new scale.
    it('windows the anchored range in the same pass as a wheel zoom', () => {
        render(mockSchedule());
        const prevScale = component.scale();
        const left = ribbon().scrollLeft;
        // Zoom in to the maximum around the right edge of the ribbon.
        const anchorPx = ribbonWidth - 20;
        component.onRibbonWheel(
            new WheelEvent('wheel', {
                ctrlKey: true,
                clientX: anchorPx,
                deltaY: -1000,
            })
        );
        fixture.detectChanges();

        const nextScale = component.scale();
        expect(nextScale).toBeGreaterThan(prevScale);
        const anchoredLeft =
            ((left + anchorPx) / prevScale) * nextScale - anchorPx;
        const windowed = component.ribbonWindow.items().map((e) => e.key);
        expect(windowed).toEqual(
            expect.arrayContaining(itemsIn(anchoredLeft, ribbonWidth))
        );
    });

    it('windows an expanded group before the ribbon scrolls to it', () => {
        render(mockSchedule());
        const first = component
            .blocks()
            .find((block) => block.program.title === 'Slot 200');
        const last = component
            .blocks()
            .find((block) => block.program.title === 'Slot 203');
        if (!first || !last) throw new Error('missing slots');
        jest.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(
            () => undefined
        );

        component.onGroupExpand({
            startMs: first.startMs,
            stopMs: last.stopMs,
        } as Parameters<EpgTimelineComponent['onGroupExpand']>[0]);
        fixture.detectChanges();

        expect(renderedTitles()).toEqual(
            expect.arrayContaining(['Slot 200', 'Slot 203'])
        );
        expect(renderedTitles()).not.toContain('Slot 96');
    });

    it('does not re-render for a scroll within a quarter viewport', () => {
        render(mockSchedule());
        const before = component.ribbonWindow.items();

        scrollRibbonTo(ribbon().scrollLeft + ribbonWidth / 8);

        expect(component.ribbonWindow.items()).toBe(before);
    });

    it('keeps the selected programme highlighted after scrolling away and back', () => {
        render(mockSchedule());
        const selectedTitle = 'Slot 97';
        const selected = Array.from(
            fixture.nativeElement.querySelectorAll(
                '.epg-timeline__block'
            ) as NodeListOf<HTMLElement>
        ).find(
            (block) =>
                block
                    .querySelector('.epg-timeline__block-title')
                    ?.textContent?.trim() === selectedTitle
        ) as HTMLElement;
        selected.click();
        fixture.detectChanges();
        const start = ribbon().scrollLeft;

        scrollRibbonTo(blockLeftPx('Slot 230'));
        expect(renderedTitles()).not.toContain(selectedTitle);
        scrollRibbonTo(start);

        const highlighted = fixture.nativeElement.querySelector(
            '.epg-timeline__block.is-selected .epg-timeline__block-title'
        ) as HTMLElement;
        expect(highlighted.textContent?.trim()).toBe(selectedTitle);
    });

    it('marks a far-away catch-up programme as playing once it is in view', () => {
        const schedule = mockSchedule();
        render(schedule);
        fixture.componentRef.setInput('activeProgram', schedule[2]);
        fixture.detectChanges();
        expect(renderedTitles()).not.toContain('Slot 2');

        scrollRibbonTo(blockLeftPx('Slot 2'));

        const playing = fixture.nativeElement.querySelector(
            '.epg-timeline__block.is-playing .epg-timeline__block-title'
        ) as HTMLElement;
        expect(playing.textContent?.trim()).toBe('Slot 2');
    });

    it('widens the window when the ribbon grows', () => {
        render(mockSchedule());
        const before = renderedTitles().length;

        ribbonWidth = 2400;
        component.ribbonWindow.measureWidth();
        fixture.detectChanges();

        expect(renderedTitles().length).toBeGreaterThan(before);
        expect(renderedTitles()).toContain('Slot 96');
    });

    it('keeps the window on now when a resize reports before the focus scroll', () => {
        // The observer's first report can precede the auto-focus scroll,
        // while the ribbon is still at its left edge: it must not move the
        // window to the start of the schedule.
        fixture.componentRef.setInput('programs', mockSchedule());
        fixture.detectChanges();
        expect(ribbon().scrollLeft).toBe(0);

        ribbonWidth = 1200;
        component.ribbonWindow.measureWidth();
        fixture.detectChanges();

        expect(renderedTitles()).toContain('Slot 96');
        expect(renderedTitles()).not.toContain('Slot 0');
    });

    it('keeps the window where the ribbon is when a small scroll commits another day', () => {
        // A scroll under the re-window step can still cross midnight; the
        // committed day must not re-centre the window on its noon.
        render(mockSchedule());
        const tomorrow = new Date(Date.now() + 24 * 60 * TIMELINE_MINUTE_MS);
        const pad = (n: number) => String(n).padStart(2, '0');
        component.viewDayKey.set(
            `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
        );
        fixture.detectChanges();

        expect(renderedTitles()).toContain('Slot 96');
    });

    it('does not follow the now tick away from an unscrolled ribbon', () => {
        render(mockSchedule());

        component.nowMs.set(Date.now() + 12 * 60 * TIMELINE_MINUTE_MS);
        fixture.detectChanges();

        expect(renderedTitles()).toContain('Slot 96');
    });

    it('starts over around now when another channel loads', () => {
        render(mockSchedule());
        scrollRibbonTo(blockLeftPx('Slot 230'));
        expect(renderedTitles()).not.toContain('Slot 96');

        render(
            mockSchedule().map((program) => ({ ...program, channel: 'other' }))
        );

        expect(renderedTitles()).toContain('Slot 96');
    });
});

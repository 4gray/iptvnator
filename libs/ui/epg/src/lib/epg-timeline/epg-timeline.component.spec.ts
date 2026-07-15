import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { EpgTimelineComponent } from './epg-timeline.component';
import { TimelineBlock } from './epg-timeline.utils';

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

/** Local yyyy-MM-dd day-key for a programme start (matches the component). */
function localDateKey(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('EpgTimelineComponent', () => {
    let fixture: ComponentFixture<EpgTimelineComponent>;
    let component: EpgTimelineComponent;

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
                    },
                },
            ],
        });

        fixture = TestBed.createComponent(EpgTimelineComponent);
        component = fixture.componentInstance;
    });

    function setInputs(inputs: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(key, value);
        }
    }

    it('renders the ribbon when programmes exist for the current day', () => {
        // start at "now" (offset 0) so the date-key is always today, even when
        // the suite runs just after local midnight.
        setInputs({ programs: [programAt(0, 120, 'Now')] });
        expect(component.renderState()).toBe('ribbon');
        expect(component.emptyStateReason()).toBe('none');
    });

    it('shows the loading state regardless of programmes', () => {
        setInputs({ programs: [programAt(0, 60)], loading: true });
        expect(component.renderState()).toBe('loading');
    });

    it('falls back to channel-unmapped when there are no programmes', () => {
        setInputs({ programs: [] });
        expect(component.renderState()).toBe('channel-unmapped');
        expect(component.emptyStateReason()).toBe('channel-unmapped');
    });

    it('honours an explicit empty reason from the host', () => {
        setInputs({ programs: [], emptyReason: 'provider-no-epg' });
        expect(component.renderState()).toBe('provider-no-epg');
    });

    it('reports empty-day when programmes exist but not for the viewed day', () => {
        // A programme three days from now: today has nothing.
        setInputs({ programs: [programAt(3 * 1440, 60)] });
        expect(component.renderState()).toBe('empty-day');
    });

    it('honours a controlled non-today selectedDate instead of resetting to today', () => {
        // Data three days out (today empty). Without honouring the controlled
        // input the panel would show empty-day for today; with it, the ribbon
        // renders on the host-selected day.
        const future = programAt(3 * 1440, 60);
        setInputs({
            programs: [future],
            selectedDate: localDateKey(future.start),
        });
        expect(component.renderState()).toBe('ribbon');
    });

    it('follows a programmatic selectedDate change from the host', () => {
        const future = programAt(3 * 1440, 60);
        setInputs({ programs: [future] });
        expect(component.renderState()).toBe('empty-day'); // viewing today
        setInputs({ selectedDate: localDateKey(future.start) });
        expect(component.renderState()).toBe('ribbon'); // followed the host
    });

    it('shows the ribbon controls (Now + zoom) only while a ribbon renders', () => {
        setInputs({ programs: [programAt(0, 120, 'Now')] });
        expect(component.showRibbonControls()).toBe(true);

        setInputs({ programs: [programAt(3 * 1440, 60)] }); // empty-day
        expect(component.showRibbonControls()).toBe(false);

        setInputs({ programs: [] }); // channel-unmapped
        expect(component.showRibbonControls()).toBe(false);

        setInputs({ programs: [programAt(0, 120)], loading: true });
        expect(component.showRibbonControls()).toBe(false);
    });

    it('shows the date stepper for ribbon + empty-day, hides it with no EPG anywhere', () => {
        setInputs({ programs: [programAt(0, 120)] });
        expect(component.showDateStepper()).toBe(true); // ribbon

        setInputs({ programs: [programAt(3 * 1440, 60)] });
        expect(component.renderState()).toBe('empty-day');
        expect(component.showDateStepper()).toBe(true);

        setInputs({ programs: [] });
        expect(component.renderState()).toBe('channel-unmapped');
        expect(component.showDateStepper()).toBe(false);

        setInputs({ programs: [], emptyReason: 'provider-no-epg' });
        expect(component.showDateStepper()).toBe(false);
    });

    it('only offers catch-up on past blocks when archive is available', () => {
        setInputs({
            programs: [programAt(-180, 60, 'Earlier')],
            archivePlaybackAvailable: true,
            archiveDays: 7,
        });
        const past = component.blocks().find((b) => b.when === 'past');
        expect(past).toBeDefined();
        expect(component.canCatchUp(past as TimelineBlock)).toBe(true);

        setInputs({ archivePlaybackAvailable: false });
        expect(component.canCatchUp(past as TimelineBlock)).toBe(false);
    });

    it('emits a timeshift activation when a catch-up block is clicked', () => {
        setInputs({
            programs: [programAt(-180, 60, 'Earlier')],
            archivePlaybackAvailable: true,
            archiveDays: 7,
        });
        const past = component.blocks().find((b) => b.when === 'past');
        expect(past).toBeDefined();
        const events: string[] = [];
        component.programActivated.subscribe((e) => events.push(e.type));

        component.onBlockClick(past as TimelineBlock);
        expect(events).toEqual(['timeshift']);
    });

    it('emits returnToLive when the on-now block is clicked', () => {
        setInputs({ programs: [programAt(-30, 60, 'Live')] });
        const now = component.blocks().find((b) => b.when === 'now');
        expect(now).toBeDefined();
        let returned = false;
        component.returnToLive.subscribe(() => (returned = true));

        component.onBlockClick(now as TimelineBlock);
        expect(returned).toBe(true);
    });

    it('emits normalized recording times from the programme dialog', () => {
        const program = programAt(-5, 60, 'Record me');
        setInputs({ programs: [program], recordingAvailable: true });
        const block = component.blocks().find((item) => item.when === 'now');
        const dialog = TestBed.inject(MatDialog);
        jest.spyOn(dialog, 'open').mockReturnValue({
            afterClosed: () => of('record'),
        } as never);
        const events: Array<{ scheduledStartAt: string }> = [];
        component.recordingRequested.subscribe((event) => events.push(event));

        component.openDetails(block as TimelineBlock);

        expect(events).toEqual([
            expect.objectContaining({
                program,
                scheduledStartAt: new Date(
                    (block as TimelineBlock).startMs
                ).toISOString(),
            }),
        ]);
    });

    it('emits the centred day when stepping forward', () => {
        setInputs({ programs: [programAt(-30, 60)] });
        const emitted: string[] = [];
        component.selectedDateChange.subscribe((d) => emitted.push(d));

        component.stepDay('next');
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('toggles the collapsed state through the output', () => {
        setInputs({ collapsed: false });
        const emitted: boolean[] = [];
        component.collapsedChange.subscribe((v) => emitted.push(v));

        component.toggleCollapsed();
        expect(emitted).toEqual([true]);
    });

    it('derives a live progress percentage from the summary', () => {
        const start = new Date(Date.now() - 30 * 60_000).toISOString();
        const stop = new Date(Date.now() + 30 * 60_000).toISOString();
        setInputs({ collapsed: true, summary: { title: 'Now', start, stop } });

        expect(component.hasSummary()).toBe(true);
        expect(component.progress()).toBeGreaterThan(40);
        expect(component.progress()).toBeLessThan(60);
        expect(component.minutesLeft()).toBeGreaterThan(0);
    });

    it('clamps the zoom and rescales render items', () => {
        setInputs({ programs: [programAt(-60, 120, 'Wide')] });
        const before = component.renderItems().length;

        component.onZoom(99);
        expect(component.scale()).toBe(component.zoomMax);
        component.onZoom(0);
        expect(component.scale()).toBe(component.zoomMin);
        // render items still produced after zooming
        expect(component.renderItems().length).toBe(before);
    });

    it('expands a group chip by zooming in', () => {
        setInputs({ programs: [programAt(-60, 120, 'Wide')] });
        component.onGroupExpand({
            kind: 'group',
            key: 'g',
            leftPx: 0,
            widthPx: 40,
            count: 4,
            startMs: Date.now() - 60 * 60_000,
            stopMs: Date.now(),
        });
        expect(component.scale()).toBeGreaterThan(3);
    });
});

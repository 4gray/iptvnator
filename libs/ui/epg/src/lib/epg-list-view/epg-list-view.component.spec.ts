import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { EpgListViewComponent } from './epg-list-view.component';
import { EpgListRow } from './epg-list-view.utils';

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

function localDateKey(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('EpgListViewComponent', () => {
    let fixture: ComponentFixture<EpgListViewComponent>;
    let component: EpgListViewComponent;
    let dialogResult: BehaviorSubject<'live' | 'timeshift' | undefined>;

    beforeEach(() => {
        dialogResult = new BehaviorSubject<'live' | 'timeshift' | undefined>(
            undefined
        );
        TestBed.configureTestingModule({
            imports: [EpgListViewComponent],
            providers: [
                {
                    provide: MatDialog,
                    useValue: {
                        open: () => ({ afterClosed: () => dialogResult }),
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

        fixture = TestBed.createComponent(EpgListViewComponent);
        component = fixture.componentInstance;
    });

    function setInputs(inputs: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(key, value);
        }
    }

    function rowWhen(when: EpgListRow['when']): EpgListRow {
        const row = component.rows().find((r) => r.when === when);
        expect(row).toBeDefined();
        return row as EpgListRow;
    }

    it('renders the list when programmes exist for the current day', () => {
        setInputs({ programs: [programAt(0, 120, 'Now')] });
        expect(component.renderState()).toBe('list');
        expect(component.emptyStateReason()).toBe('none');
    });

    it('shows the loading state regardless of programmes', () => {
        setInputs({ programs: [programAt(0, 60)], loading: true });
        expect(component.renderState()).toBe('loading');
    });

    it('falls back to channel-unmapped when there are no programmes', () => {
        setInputs({ programs: [] });
        expect(component.renderState()).toBe('channel-unmapped');
    });

    it('honours an explicit empty reason from the host', () => {
        setInputs({ programs: [], emptyReason: 'provider-no-epg' });
        expect(component.renderState()).toBe('provider-no-epg');
    });

    it('reports empty-day when programmes exist but not for the viewed day', () => {
        setInputs({ programs: [programAt(3 * 1440, 60)] });
        expect(component.renderState()).toBe('empty-day');
    });

    it('honours a controlled non-today selectedDate', () => {
        const future = programAt(3 * 1440, 60);
        setInputs({
            programs: [future],
            selectedDate: localDateKey(future.start),
        });
        expect(component.renderState()).toBe('list');
    });

    it('follows a programmatic selectedDate change from the host', () => {
        const future = programAt(3 * 1440, 60);
        setInputs({ programs: [future] });
        expect(component.renderState()).toBe('empty-day');
        setInputs({ selectedDate: localDateKey(future.start) });
        expect(component.renderState()).toBe('list');
    });

    it('shows the date stepper for list + empty-day, hides it with no EPG anywhere', () => {
        setInputs({ programs: [programAt(0, 120)] });
        expect(component.showDateStepper()).toBe(true);

        setInputs({ programs: [programAt(3 * 1440, 60)] });
        expect(component.renderState()).toBe('empty-day');
        expect(component.showDateStepper()).toBe(true);

        setInputs({ programs: [] });
        expect(component.showDateStepper()).toBe(false);

        setInputs({ programs: [], emptyReason: 'provider-no-epg' });
        expect(component.showDateStepper()).toBe(false);
    });

    it('shows the Now jump only off-today or while watching archive', () => {
        setInputs({ programs: [programAt(0, 120)], isLivePlayback: true });
        expect(component.showJump()).toBe(false); // today + live

        setInputs({ isLivePlayback: false });
        expect(component.showJump()).toBe(true); // watching archive
    });

    it('emits returnToLive when the on-now row is activated', () => {
        setInputs({ programs: [programAt(-30, 60, 'Live')] });
        let returned = false;
        component.returnToLive.subscribe(() => (returned = true));

        component.onRowActivate(rowWhen('now'));
        expect(returned).toBe(true);
    });

    it('emits a timeshift activation when a catch-up row is activated', () => {
        // Anchor the viewed day to the fixture's own day: a "3 hours ago"
        // programme belongs to *yesterday* when the suite runs 00:00–02:00
        // local, and today's row filter would drop it (midnight flakiness).
        const past = programAt(-180, 60, 'Earlier');
        setInputs({
            programs: [past],
            selectedDate: localDateKey(past.start),
            archivePlaybackAvailable: true,
            archiveDays: 7,
        });
        const events: string[] = [];
        component.programActivated.subscribe((e) => events.push(e.type));

        component.onRowActivate(rowWhen('past'));
        expect(events).toEqual(['timeshift']);
    });

    it('does not activate a past row when catch-up is unavailable', () => {
        const past = programAt(-180, 60, 'Earlier');
        setInputs({
            programs: [past],
            selectedDate: localDateKey(past.start),
            archivePlaybackAvailable: false,
        });
        const events: string[] = [];
        component.programActivated.subscribe((e) => events.push(e.type));
        let returned = false;
        component.returnToLive.subscribe(() => (returned = true));

        component.onRowActivate(rowWhen('past'));
        expect(events).toEqual([]);
        expect(returned).toBe(false);
    });

    it('emits timeshift from the explicit Watch affordance', () => {
        const past = programAt(-180, 60, 'Earlier');
        setInputs({
            programs: [past],
            selectedDate: localDateKey(past.start),
            archivePlaybackAvailable: true,
            archiveDays: 7,
        });
        const events: string[] = [];
        component.programActivated.subscribe((e) => events.push(e.type));

        component.onWatch(rowWhen('past'));
        expect(events).toEqual(['timeshift']);
    });

    it('opens details and reacts to a timeshift dialog result', () => {
        const past = programAt(-180, 60, 'Earlier');
        setInputs({
            programs: [past],
            selectedDate: localDateKey(past.start),
            archivePlaybackAvailable: true,
            archiveDays: 7,
        });
        dialogResult.next('timeshift');
        const events: string[] = [];
        component.programActivated.subscribe((e) => events.push(e.type));

        component.openDetails(rowWhen('past'));
        expect(events).toEqual(['timeshift']);
    });

    it('emits the day when stepping forward', () => {
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

    it('derives a live progress percentage from the summary when collapsed', () => {
        const start = new Date(Date.now() - 30 * 60_000).toISOString();
        const stop = new Date(Date.now() + 30 * 60_000).toISOString();
        setInputs({ collapsed: true, summary: { title: 'Now', start, stop } });

        expect(component.hasSummary()).toBe(true);
        expect(component.progress()).toBeGreaterThan(40);
        expect(component.progress()).toBeLessThan(60);
        expect(component.minutesLeft()).toBeGreaterThan(0);
    });
});

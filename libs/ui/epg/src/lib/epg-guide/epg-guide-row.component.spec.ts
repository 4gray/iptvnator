import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { buildGuideDayAxis, EpgGuideDayAxis } from './epg-guide-layout.util';
import { EpgGuideRowStatus } from './epg-guide-programs.service';
import { EpgGuideRowComponent } from './epg-guide-row.component';
import { EpgGuideChannel } from './epg-guide-source';

const MINUTE_MS = 60_000;

const CHANNEL: EpgGuideChannel = {
    id: 'a',
    number: 1,
    name: 'Channel a',
    logoUrl: null,
    epgKey: 'a',
};

function todayDateKey(): string {
    const now = new Date();
    const pad = (value: number) => `${value}`.padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
    )}`;
}

describe('EpgGuideRowComponent', () => {
    let fixture: ComponentFixture<EpgGuideRowComponent>;
    let component: EpgGuideRowComponent;
    let axis: EpgGuideDayAxis;
    /** Fixed "now" in the middle of the rendered day, so no case is clock-dependent. */
    let nowMs: number;

    function program(
        title: string,
        fromNowMin: number,
        toNowMin: number
    ): EpgProgram {
        return {
            start: new Date(nowMs + fromNowMin * MINUTE_MS).toISOString(),
            stop: new Date(nowMs + toNowMin * MINUTE_MS).toISOString(),
            channel: 'a',
            title,
            desc: null,
            category: null,
        };
    }

    function render(
        programs: readonly EpgProgram[],
        overrides: {
            status?: EpgGuideRowStatus;
            catchUpAvailable?: boolean;
            rowFocused?: boolean;
            focusedBlock?: number | null;
            tabbable?: boolean;
        } = {}
    ): void {
        fixture.componentRef.setInput('channel', CHANNEL);
        fixture.componentRef.setInput('axis', axis);
        fixture.componentRef.setInput('programs', programs);
        fixture.componentRef.setInput('status', overrides.status ?? 'loaded');
        fixture.componentRef.setInput('nowMs', nowMs);
        fixture.componentRef.setInput('hourWidthPx', 240);
        fixture.componentRef.setInput(
            'catchUpAvailable',
            overrides.catchUpAvailable ?? false
        );
        fixture.componentRef.setInput(
            'rowFocused',
            overrides.rowFocused ?? false
        );
        fixture.componentRef.setInput(
            'focusedBlock',
            overrides.focusedBlock ?? null
        );
        fixture.componentRef.setInput('tabbable', overrides.tabbable ?? false);
        fixture.detectChanges();
    }

    function tabIndexes(): (string | null)[] {
        return fixture.debugElement
            .queryAll(By.css('[data-epg-guide-grid]'))
            .map((element) =>
                (element.nativeElement as HTMLElement).getAttribute('tabindex')
            );
    }

    beforeEach(() => {
        axis = buildGuideDayAxis(todayDateKey());
        nowMs = axis.startMs + 12 * 60 * MINUTE_MS;
        TestBed.configureTestingModule({
            imports: [EpgGuideRowComponent],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        onTranslationChange: new BehaviorSubject(null),
                        onDefaultLangChange: new BehaviorSubject(null),
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                    },
                },
            ],
        });
        fixture = TestBed.createComponent(EpgGuideRowComponent);
        component = fixture.componentInstance;
    });

    it('activates the channel when the on-now card is clicked', () => {
        render([program('on now', -20, 40)]);
        const activated = jest.fn();
        const details = jest.fn();
        component.channelActivated.subscribe(activated);
        component.detailsRequested.subscribe(details);

        const card = fixture.debugElement.query(
            By.css('.epg-guide-row__block')
        );
        expect(card.nativeElement.classList).toContain('is-now');
        card.nativeElement.click();

        expect(activated).toHaveBeenCalled();
        expect(details).not.toHaveBeenCalled();
    });

    it('opens details for a past card instead of switching channel', () => {
        render([program('earlier', -180, -120)]);
        const activated = jest.fn();
        const details = jest.fn();
        component.channelActivated.subscribe(activated);
        component.detailsRequested.subscribe(details);

        fixture.debugElement
            .query(By.css('.epg-guide-row__block'))
            .nativeElement.click();

        expect(details).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'block' })
        );
        expect(activated).not.toHaveBeenCalled();
    });

    it('reports a catch-up click as watch only, not as details', () => {
        render([program('earlier', -180, -120)], { catchUpAvailable: true });
        const details = jest.fn();
        const watch = jest.fn();
        component.detailsRequested.subscribe(details);
        component.watchRequested.subscribe(watch);

        const button = fixture.debugElement.query(
            By.css('.epg-guide-row__watch')
        );
        expect(button).toBeTruthy();
        button.nativeElement.click();

        expect(watch).toHaveBeenCalledWith(
            expect.objectContaining({ canCatchUp: true })
        );
        expect(details).not.toHaveBeenCalled();
    });

    it('renders the empty note when the host says there is no EPG', () => {
        render([], { status: 'none' });

        expect(
            fixture.debugElement.query(By.css('.epg-guide-row__empty'))
        ).toBeTruthy();
        expect(
            fixture.debugElement.queryAll(By.css('.epg-guide-row__skeleton'))
        ).toHaveLength(0);
    });

    it('renders skeletons while programmes are loading', () => {
        render([], { status: 'loading' });

        expect(
            fixture.debugElement.queryAll(By.css('.epg-guide-row__skeleton'))
                .length
        ).toBeGreaterThan(0);
        expect(
            fixture.debugElement.query(By.css('.epg-guide-row__empty'))
        ).toBeNull();
    });

    it('moves the roving tabindex between the channel cell and the focused card', () => {
        // [channel cell, card] — a row nobody points at is fully untabbable.
        render([program('on now', -20, 40)]);
        expect(tabIndexes()).toEqual(['-1', '-1']);

        // The shell's fallback row: Tab lands on the channel cell.
        render([program('on now', -20, 40)], { tabbable: true });
        expect(tabIndexes()).toEqual(['0', '-1']);

        // Keyboard focus on the row itself keeps it on the channel cell...
        render([program('on now', -20, 40)], { rowFocused: true });
        expect(tabIndexes()).toEqual(['0', '-1']);

        // ...and moves to the card once a programme is focused.
        render([program('on now', -20, 40)], {
            rowFocused: true,
            focusedBlock: 0,
        });
        expect(tabIndexes()).toEqual(['-1', '0']);
    });

    it('reports the clicked cell so the roving focus follows the mouse', () => {
        render([program('on now', -20, 40)]);
        const focused: (number | null)[] = [];
        component.focusRequested.subscribe((block) => focused.push(block));

        fixture.debugElement
            .query(By.css('.epg-guide-row__channel'))
            .nativeElement.click();
        fixture.debugElement
            .query(By.css('.epg-guide-row__block'))
            .nativeElement.click();

        expect(focused).toEqual([null, 0]);
    });

    it('exposes the grid roles the guide viewport announces', () => {
        render([program('on now', -20, 40)]);

        expect(fixture.nativeElement.getAttribute('role')).toBe('row');
        expect(
            fixture.debugElement
                .queryAll(By.css('[role="gridcell"]'))
                .map((cell) => (cell.nativeElement as HTMLElement).className)
        ).toEqual(['epg-guide-row__channel-cell', 'epg-guide-row__lane']);
    });

    it('marks its channel cell and cards as guide-owned keyboard surfaces', () => {
        render([program('on now', -20, 40)]);

        expect(
            fixture.debugElement.queryAll(By.css('[data-epg-guide-grid]'))
        ).toHaveLength(2);
    });
});

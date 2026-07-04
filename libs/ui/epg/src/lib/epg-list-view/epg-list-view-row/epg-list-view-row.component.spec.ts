import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgListRow } from '../epg-list-view.utils';
import { EpgListViewRowComponent } from './epg-list-view-row.component';

function program(title = 'P', desc: string | null = null): EpgProgram {
    return {
        start: new Date().toISOString(),
        stop: new Date().toISOString(),
        channel: 'ch',
        title,
        desc,
        category: null,
    };
}

function row(overrides: Partial<EpgListRow> = {}): EpgListRow {
    return {
        program: program(),
        key: 'k',
        startMs: Date.now(),
        stopMs: Date.now() + 60_000,
        when: 'future',
        progress: null,
        isActive: false,
        canCatchUp: false,
        ...overrides,
    };
}

describe('EpgListViewRowComponent', () => {
    let fixture: ComponentFixture<EpgListViewRowComponent>;
    let component: EpgListViewRowComponent;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [EpgListViewRowComponent, TranslateModule.forRoot()],
        });
        fixture = TestBed.createComponent(EpgListViewRowComponent);
        component = fixture.componentInstance;
    });

    it('marks an active past programme as playing (archive), not a now row', () => {
        fixture.componentRef.setInput('row', row({ when: 'past', isActive: true }));
        expect(component.isPlaying()).toBe(true);

        fixture.componentRef.setInput('row', row({ when: 'now', isActive: true }));
        expect(component.isPlaying()).toBe(false);
    });

    it('computes minutes left for a now row from the tick', () => {
        const stopMs = Date.now() + 25 * 60_000;
        fixture.componentRef.setInput('row', row({ when: 'now', stopMs }));
        fixture.componentRef.setInput('nowMs', Date.now());
        expect(component.minutesLeft()).toBeGreaterThanOrEqual(24);
        expect(component.minutesLeft()).toBeLessThanOrEqual(25);
    });

    it('activates on keyboard only when the row itself is the target', () => {
        fixture.componentRef.setInput('row', row());
        const events: string[] = [];
        component.activate.subscribe(() => events.push('activate'));

        const host = fixture.nativeElement as HTMLElement;
        const nested = document.createElement('button');

        // Enter bubbling up from a nested watch/info button must NOT activate
        // the row (and must not preventDefault, which would suppress the
        // button's own native click).
        const fromButton = {
            target: nested,
            currentTarget: host,
            preventDefault: jest.fn(),
        } as unknown as Event;
        component.onKeydown(fromButton);
        expect(events).toEqual([]);
        expect(
            (fromButton as unknown as { preventDefault: jest.Mock })
                .preventDefault
        ).not.toHaveBeenCalled();

        // Enter on the focused row itself activates it.
        const fromRow = {
            target: host,
            currentTarget: host,
            preventDefault: jest.fn(),
        } as unknown as Event;
        component.onKeydown(fromRow);
        expect(events).toEqual(['activate']);
    });

    it('emits activate on row click and stops propagation on watch/info', () => {
        fixture.componentRef.setInput('row', row());
        const events: string[] = [];
        component.activate.subscribe(() => events.push('activate'));
        component.watch.subscribe(() => events.push('watch'));
        component.info.subscribe(() => events.push('info'));

        component.onRowClick();
        const stop = jest.fn();
        component.onWatch({ stopPropagation: stop } as unknown as Event);
        component.onInfo({ stopPropagation: stop } as unknown as Event);

        expect(events).toEqual(['activate', 'watch', 'info']);
        expect(stop).toHaveBeenCalledTimes(2);
    });

    it('renders the temporal state and catch-up Watch affordance', () => {
        fixture.componentRef.setInput(
            'row',
            row({ when: 'past', canCatchUp: true })
        );
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        expect(host.getAttribute('data-when')).toBe('past');
        expect(host.querySelector('.watch')).not.toBeNull();
    });

    it('renders the live progress bar for a now row and hides Watch', () => {
        fixture.componentRef.setInput(
            'row',
            row({ when: 'now', progress: 40, canCatchUp: false })
        );
        fixture.detectChanges();
        const host = fixture.nativeElement as HTMLElement;
        expect(host.getAttribute('data-when')).toBe('now');
        expect(host.querySelector('.g-now-bar')).not.toBeNull();
        expect(host.querySelector('.watch')).toBeNull();
    });
});

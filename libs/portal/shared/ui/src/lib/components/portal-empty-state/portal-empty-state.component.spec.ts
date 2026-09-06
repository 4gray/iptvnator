import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PortalEmptyStateComponent } from './portal-empty-state.component';

describe('PortalEmptyStateComponent', () => {
    let fixture: ComponentFixture<PortalEmptyStateComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PortalEmptyStateComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(PortalEmptyStateComponent);
        fixture.componentRef.setInput('message', 'Nothing here');
        fixture.detectChanges();
    });

    it('renders only the icon and message by default', () => {
        const host: HTMLElement = fixture.nativeElement;

        expect(host.querySelector('.empty-state-icon')?.textContent).toBe(
            'live_tv'
        );
        expect(host.querySelector('.empty-state-title')?.textContent).toBe(
            'Nothing here'
        );
        expect(host.querySelector('.empty-state-hint')).toBeNull();
        expect(host.querySelector('.empty-state-action')).toBeNull();
    });

    it('renders the hint and a labelled action that emits on click', () => {
        const action = jest.fn();
        fixture.componentInstance.action.subscribe(action);
        fixture.componentRef.setInput('hint', 'Try the button');
        fixture.componentRef.setInput('actionLabel', 'Do it');
        fixture.componentRef.setInput('actionIcon', 'chevron_right');
        fixture.detectChanges();

        const host: HTMLElement = fixture.nativeElement;
        const button = host.querySelector<HTMLButtonElement>(
            'button.empty-state-action'
        );

        expect(host.querySelector('.empty-state-hint')?.textContent).toBe(
            'Try the button'
        );
        expect(button?.textContent).toContain('Do it');
        expect(button?.querySelector('mat-icon')?.textContent).toBe(
            'chevron_right'
        );

        button?.click();

        expect(action).toHaveBeenCalledTimes(1);
    });
});

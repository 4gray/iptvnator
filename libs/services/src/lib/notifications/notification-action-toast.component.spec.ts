import { TestBed } from '@angular/core/testing';
import {
    MAT_SNACK_BAR_DATA,
    MatSnackBarRef,
} from '@angular/material/snack-bar';
import { NotificationActionToastComponent } from './notification-action-toast.component';

describe('NotificationActionToastComponent', () => {
    const ref = { dismiss: jest.fn(), dismissWithAction: jest.fn() };

    beforeEach(async () => {
        ref.dismiss.mockClear();
        ref.dismissWithAction.mockClear();
        await TestBed.configureTestingModule({
            imports: [NotificationActionToastComponent],
            providers: [
                { provide: MatSnackBarRef, useValue: ref },
                {
                    provide: MAT_SNACK_BAR_DATA,
                    useValue: {
                        message: 'Certificate is invalid.',
                        actionLabel: 'Trust host',
                        closeLabel: 'Close',
                    },
                },
            ],
        }).compileComponents();
    });

    function render(): HTMLElement {
        const fixture = TestBed.createComponent(
            NotificationActionToastComponent
        );
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('shows the message, the action and a labelled Close button', () => {
        const element = render();

        expect(element.textContent).toContain('Certificate is invalid.');
        expect(
            element.querySelector('.app-notification__action')?.textContent
        ).toContain('Trust host');
        expect(
            element
                .querySelector('.app-notification__close')
                ?.getAttribute('aria-label')
        ).toBe('Close');
    });

    it('runs the action only from the action button', () => {
        const element = render();

        (
            element.querySelector('.app-notification__close') as HTMLElement
        ).click();
        expect(ref.dismiss).toHaveBeenCalledTimes(1);
        expect(ref.dismissWithAction).not.toHaveBeenCalled();

        (
            element.querySelector('.app-notification__action') as HTMLElement
        ).click();
        expect(ref.dismissWithAction).toHaveBeenCalledTimes(1);
    });
});

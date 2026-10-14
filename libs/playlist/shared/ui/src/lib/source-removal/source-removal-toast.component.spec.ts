import { TestBed } from '@angular/core/testing';
import {
    MAT_SNACK_BAR_DATA,
    MatSnackBarRef,
} from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { SourceRemovalToastComponent } from './source-removal-toast.component';

describe('SourceRemovalToastComponent', () => {
    let opened: Subject<void>;
    let dismissed: Subject<void>;
    let ref: {
        afterOpened: () => Subject<void>;
        afterDismissed: () => Subject<void>;
        dismiss: jest.Mock;
        dismissWithAction: jest.Mock;
    };
    let data: Record<string, unknown>;

    const render = () => {
        const fixture = TestBed.createComponent(SourceRemovalToastComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);
        return fixture.nativeElement as HTMLElement;
    };

    beforeEach(() => {
        opened = new Subject<void>();
        dismissed = new Subject<void>();
        ref = {
            afterOpened: () => opened,
            afterDismissed: () => dismissed,
            dismiss: jest.fn(),
            dismissWithAction: jest.fn(),
        };
        data = {
            message: 'Removed “Alpha”',
            undoLabel: 'Undo',
            closeLabel: 'Close',
        };
        TestBed.configureTestingModule({
            imports: [SourceRemovalToastComponent],
            providers: [
                { provide: MAT_SNACK_BAR_DATA, useFactory: () => data },
                { provide: MatSnackBarRef, useValue: ref },
            ],
        });
    });

    it('undoes, or commits at once from the close button', () => {
        const element = render();
        expect(element.textContent).toContain('Removed “Alpha”');
        element
            .querySelector<HTMLButtonElement>('.source-removal-toast__undo')
            ?.click();
        expect(ref.dismissWithAction).toHaveBeenCalled();
        element
            .querySelector<HTMLButtonElement>('.source-removal-toast__close')
            ?.click();
        expect(ref.dismiss).toHaveBeenCalled();
        expect(
            element
                .querySelector('.source-removal-toast__close')
                ?.getAttribute('aria-label')
        ).toBe('Close');
    });

    it('commits through the service from the close button when it can', () => {
        const commitNow = jest.fn();
        data['commitNow'] = commitNow;
        render()
            .querySelector<HTMLButtonElement>('.source-removal-toast__close')
            ?.click();
        expect(commitNow).toHaveBeenCalled();
        expect(ref.dismiss).not.toHaveBeenCalled();
    });

    it('takes the focus when the delete left it nowhere', () => {
        const element = render();
        (document.activeElement as HTMLElement | null)?.blur();
        opened.next();
        expect(document.activeElement).toBe(
            element.querySelector('.source-removal-toast__undo')
        );
    });

    it('takes the focus from a closing surface and gives it back after', () => {
        const trigger = document.createElement('button');
        document.body.appendChild(trigger);
        trigger.focus();
        data['returnFocusTo'] = trigger;
        const element = render();
        const undo = element.querySelector<HTMLButtonElement>(
            '.source-removal-toast__undo'
        );

        opened.next();
        expect(document.activeElement).toBe(undo);

        // The toast leaves the page and its focus with it.
        element.remove();
        dismissed.next();
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('leaves the focus where the user put it', () => {
        render();
        const elsewhere = document.createElement('button');
        document.body.appendChild(elsewhere);
        elsewhere.focus();
        opened.next();
        expect(document.activeElement).toBe(elsewhere);
        elsewhere.remove();
    });
});

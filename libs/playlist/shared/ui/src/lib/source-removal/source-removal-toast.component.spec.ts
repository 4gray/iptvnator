import { TestBed } from '@angular/core/testing';
import {
    MAT_SNACK_BAR_DATA,
    MatSnackBarRef,
} from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { SourceRemovalToastComponent } from './source-removal-toast.component';

describe('SourceRemovalToastComponent', () => {
    let opened: Subject<void>;
    let ref: {
        afterOpened: () => Subject<void>;
        dismiss: jest.Mock;
        dismissWithAction: jest.Mock;
    };

    const render = () => {
        const fixture = TestBed.createComponent(SourceRemovalToastComponent);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);
        return fixture.nativeElement as HTMLElement;
    };

    beforeEach(() => {
        opened = new Subject<void>();
        ref = {
            afterOpened: () => opened,
            dismiss: jest.fn(),
            dismissWithAction: jest.fn(),
        };
        TestBed.configureTestingModule({
            imports: [SourceRemovalToastComponent],
            providers: [
                {
                    provide: MAT_SNACK_BAR_DATA,
                    useValue: {
                        message: 'Removed “Alpha”',
                        undoLabel: 'Undo',
                        closeLabel: 'Close',
                    },
                },
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

    it('takes the focus when the delete left it nowhere', () => {
        const element = render();
        (document.activeElement as HTMLElement | null)?.blur();
        opened.next();
        expect(document.activeElement).toBe(
            element.querySelector('.source-removal-toast__undo')
        );
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

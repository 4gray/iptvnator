import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { ConfirmDialogComponent } from './confirm-dialog.component';

describe('ConfirmDialogComponent actions', () => {
    it.each([false, true])(
        'keeps the action in place only when requested: %s',
        async (keepOpenOnConfirm) => {
            const onConfirm = jest.fn();
            const close = jest.fn();
            await TestBed.configureTestingModule({
                imports: [
                    ConfirmDialogComponent,
                    NoopAnimationsModule,
                    TranslateModule.forRoot(),
                ],
                providers: [
                    {
                        provide: MAT_DIALOG_DATA,
                        useValue: {
                            title: 'Recovery',
                            message: '/saved/entry',
                            confirmLabel: 'Copy',
                            cancelLabel: 'Close',
                            keepOpenOnConfirm,
                            onConfirm,
                        },
                    },
                    { provide: MatDialogRef, useValue: { close } },
                ],
            }).compileComponents();
            const fixture = TestBed.createComponent(ConfirmDialogComponent);
            fixture.detectChanges();
            const buttons = fixture.nativeElement.querySelectorAll(
                'button'
            ) as NodeListOf<HTMLButtonElement>;
            buttons[1].click();
            if (keepOpenOnConfirm) {
                expect(onConfirm).toHaveBeenCalledTimes(1);
                expect(close).not.toHaveBeenCalled();
                expect(fixture.nativeElement.textContent).toContain(
                    '/saved/entry'
                );
            } else {
                expect(onConfirm).not.toHaveBeenCalled();
                expect(close).toHaveBeenCalledWith(true);
            }
            buttons[0].click();
            expect(close).toHaveBeenCalled();
        }
    );
});

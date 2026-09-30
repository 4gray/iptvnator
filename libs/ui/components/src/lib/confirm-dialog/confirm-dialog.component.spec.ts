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

describe('ConfirmDialogComponent labels and tone', () => {
    async function render(data: Record<string, unknown>) {
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
                        title: 'Remove playlist',
                        message: 'Delete it?',
                        confirmLabel: 'Remove playlist',
                        onConfirm: jest.fn(),
                        ...data,
                    },
                },
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(ConfirmDialogComponent);
        fixture.detectChanges();
        const buttons = fixture.nativeElement.querySelectorAll(
            'button'
        ) as NodeListOf<HTMLButtonElement>;
        return { cancel: buttons[0], confirm: buttons[1] };
    }

    it('names the action instead of answering "Yes", and cancels by default', async () => {
        const { cancel, confirm } = await render({});

        expect(confirm.textContent?.trim()).toBe('Remove playlist');
        // No translations are loaded, so the key is the rendered text.
        expect(cancel.textContent?.trim()).toBe('CANCEL');
        expect(confirm.classList).not.toContain('app-destructive-button');
    });

    it('styles destructive confirmations as destructive', async () => {
        const { confirm } = await render({ tone: 'destructive' });

        expect(confirm.classList).toContain('app-destructive-button');
    });
});

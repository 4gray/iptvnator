import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    createParentalLockPinThrottle,
    PARENTAL_LOCK_PIN_MAX_ATTEMPTS,
} from '@iptvnator/shared/interfaces';
import {
    ParentalLockPinDialogComponent,
    ParentalLockPinDialogData,
} from './parental-lock-pin-dialog.component';

// Without a loader the translate pipe renders the key itself.
const KEYS = {
    save: 'PARENTAL_LOCK.PIN_DIALOG.SAVE',
    unlock: 'PARENTAL_LOCK.PIN_DIALOG.UNLOCK',
    confirm: 'PARENTAL_LOCK.PIN_DIALOG.CONFIRM',
    turnOff: 'PARENTAL_LOCK.PIN_DIALOG.TURN_OFF',
    mismatch: 'PARENTAL_LOCK.PIN_DIALOG.MISMATCH',
    hint: 'PARENTAL_LOCK.PIN_DIALOG.PIN_HINT',
    wrongPin: 'PARENTAL_LOCK.PIN_DIALOG.WRONG_PIN',
};

interface DialogHarness {
    fixture: ComponentFixture<ParentalLockPinDialogComponent>;
    component: ParentalLockPinDialogComponent;
    close: jest.Mock;
    query<T extends Element = HTMLElement>(testId: string): T | null;
    type(testId: string, value: string): Promise<void>;
    /** Submits the form the way Enter in a field does. */
    pressEnter(): Promise<void>;
}

async function openDialog(
    data: ParentalLockPinDialogData
): Promise<DialogHarness> {
    TestBed.resetTestingModule();
    const close = jest.fn();
    TestBed.configureTestingModule({
        imports: [
            ParentalLockPinDialogComponent,
            NoopAnimationsModule,
            TranslateModule.forRoot(),
        ],
        providers: [
            { provide: MAT_DIALOG_DATA, useValue: data },
            { provide: MatDialogRef, useValue: { close } },
        ],
    });
    const fixture = TestBed.createComponent(ParentalLockPinDialogComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const query = <T extends Element = HTMLElement>(testId: string) =>
        root.querySelector<T>(`[data-test-id="${testId}"]`);
    return {
        fixture,
        component: fixture.componentInstance,
        close,
        query,
        async type(testId, value) {
            const input = query<HTMLInputElement>(testId);
            if (!input) throw new Error(`No input ${testId}`);
            input.value = value;
            input.dispatchEvent(new Event('input'));
            await fixture.whenStable();
        },
        async pressEnter() {
            root.querySelector('form')?.dispatchEvent(
                new Event('submit', { cancelable: true })
            );
            await fixture.whenStable();
        },
    };
}

function text(element: Element | null): string {
    return element?.textContent?.trim() ?? '';
}

describe('ParentalLockPinDialogComponent', () => {
    describe('submit labels', () => {
        it.each([
            ['unlock', undefined, KEYS.unlock],
            ['set', undefined, KEYS.save],
            ['unlock', KEYS.confirm, KEYS.confirm],
            ['unlock', KEYS.turnOff, KEYS.turnOff],
            ['set', KEYS.save, KEYS.save],
        ] as const)(
            '%s mode with submitKey %s reads %s',
            async (mode, submitKey, expected) => {
                const dialog = await openDialog({ mode, submitKey });

                expect(text(dialog.query('parental-lock-pin-submit'))).toBe(
                    expected
                );
                const dismiss = dialog.fixture.nativeElement.querySelector(
                    'mat-dialog-actions button[type="button"]'
                );
                expect(text(dismiss)).toBe('CANCEL');
            }
        );
    });

    describe('set mode', () => {
        it('asks password managers for a new password in both fields', async () => {
            const dialog = await openDialog({ mode: 'set' });

            expect(
                dialog.query('parental-lock-pin')?.getAttribute('autocomplete')
            ).toBe('new-password');
            expect(
                dialog
                    .query('parental-lock-pin-confirm')
                    ?.getAttribute('autocomplete')
            ).toBe('new-password');
        });

        it('shows the mismatch once the repeat is as long as the PIN, then saves the fixed PIN', async () => {
            const dialog = await openDialog({ mode: 'set' });
            const confirm = () =>
                dialog.query<HTMLInputElement>('parental-lock-pin-confirm');

            await dialog.type('parental-lock-pin', '2468');
            await dialog.type('parental-lock-pin-confirm', '246');
            expect(dialog.query('parental-lock-pin-mismatch')).toBeNull();
            expect(confirm()?.getAttribute('aria-invalid')).toBe('false');

            await dialog.type('parental-lock-pin-confirm', '2469');
            const error = dialog.query('parental-lock-pin-mismatch');
            expect(text(error)).toBe(KEYS.mismatch);
            expect(confirm()?.getAttribute('aria-invalid')).toBe('true');
            // Announced: the error is the input's description.
            expect(confirm()?.getAttribute('aria-describedby')).toContain(
                error?.id
            );

            // Enter is refused visibly rather than swallowed.
            expect(
                dialog.query<HTMLButtonElement>('parental-lock-pin-submit')
                    ?.disabled
            ).toBe(false);
            await dialog.pressEnter();
            expect(dialog.close).not.toHaveBeenCalled();
            expect(dialog.component.shake()).toBe('confirmation');
            expect(document.activeElement).toBe(confirm());

            await dialog.type('parental-lock-pin-confirm', '2468');
            expect(dialog.query('parental-lock-pin-mismatch')).toBeNull();
            expect(confirm()?.getAttribute('aria-invalid')).toBe('false');
            await dialog.pressEnter();
            expect(dialog.close).toHaveBeenCalledWith('2468');
        });

        it('shows the mismatch for a short repeat when Enter is pressed', async () => {
            const dialog = await openDialog({ mode: 'set' });

            await dialog.type('parental-lock-pin', '2468');
            await dialog.type('parental-lock-pin-confirm', '24');
            await dialog.pressEnter();

            expect(text(dialog.query('parental-lock-pin-mismatch'))).toBe(
                KEYS.mismatch
            );
            expect(dialog.close).not.toHaveBeenCalled();

            // Editing the repeat hands the error back to the length rule.
            await dialog.type('parental-lock-pin-confirm', '246');
            expect(dialog.query('parental-lock-pin-mismatch')).toBeNull();
        });

        it('moves on to an empty repeat on Enter in the PIN field', async () => {
            const dialog = await openDialog({ mode: 'set' });
            const enter = new KeyboardEvent('keydown', {
                key: 'Enter',
                cancelable: true,
            });

            await dialog.type('parental-lock-pin', '2468');
            dialog.query('parental-lock-pin')?.dispatchEvent(enter);
            await dialog.fixture.whenStable();

            // Handled before the form sees it: no implicit submission.
            expect(enter.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(
                dialog.query('parental-lock-pin-confirm')
            );
            expect(dialog.query('parental-lock-pin-mismatch')).toBeNull();
            expect(dialog.component.shake()).toBeNull();
        });

        it('refuses an empty repeat on Save while the PIN field keeps focus', async () => {
            // WebKit does not focus a clicked button, so focus says nothing
            // about how the form was submitted.
            const dialog = await openDialog({ mode: 'set' });

            await dialog.type('parental-lock-pin', '2468');
            dialog.query('parental-lock-pin')?.focus();
            await dialog.pressEnter();

            expect(text(dialog.query('parental-lock-pin-mismatch'))).toBe(
                KEYS.mismatch
            );
            expect(dialog.component.shake()).toBe('confirmation');
            expect(dialog.close).not.toHaveBeenCalled();
        });

        it('refuses an empty repeat when Enter is pressed in it', async () => {
            const dialog = await openDialog({ mode: 'set' });

            await dialog.type('parental-lock-pin', '2468');
            dialog.query('parental-lock-pin-confirm')?.focus();
            await dialog.pressEnter();

            expect(text(dialog.query('parental-lock-pin-mismatch'))).toBe(
                KEYS.mismatch
            );
            expect(dialog.component.shake()).toBe('confirmation');
            expect(dialog.close).not.toHaveBeenCalled();
        });

        it('lets a second refusal shake for its full time', async () => {
            const { component } = await openDialog({ mode: 'set' });
            jest.useFakeTimers();
            try {
                component.onPinInput('24');
                await component.submit();
                expect(component.shake()).toBe('pin');

                jest.advanceTimersByTime(300);
                component.onPinInput('2468');
                component.onConfirmationInput('2469');
                await component.submit();
                expect(component.shake()).toBe('confirmation');

                // The first refusal's timer must not end the second shake.
                jest.advanceTimersByTime(150);
                expect(component.shake()).toBe('confirmation');
                jest.advanceTimersByTime(250);
                expect(component.shake()).toBeNull();
            } finally {
                jest.useRealTimers();
            }
        });

        it('replays the shake when the same field is refused again', async () => {
            const dialog = await openDialog({ mode: 'set' });
            const field = dialog
                .query('parental-lock-pin')
                ?.closest('mat-form-field');
            // jsdom has no Web Animations: stand in for the running shake.
            const shake: Partial<CSSAnimation> = {
                animationName: '_ngcontent-x_pin-dialog-shake',
                currentTime: 250,
            };
            Object.defineProperty(field, 'getAnimations', {
                value: () => [shake],
            });

            await dialog.type('parental-lock-pin', '24');
            await dialog.pressEnter();
            expect(shake.currentTime).toBe(250);

            await dialog.pressEnter();
            expect(dialog.component.shake()).toBe('pin');
            expect(shake.currentTime).toBe(0);
        });

        it('refuses a too-short PIN on Enter with an error on the PIN field', async () => {
            const dialog = await openDialog({ mode: 'set' });
            const pin = () =>
                dialog.query<HTMLInputElement>('parental-lock-pin');

            await dialog.type('parental-lock-pin', '24');
            await dialog.type('parental-lock-pin-confirm', '24');
            await dialog.pressEnter();

            expect(dialog.close).not.toHaveBeenCalled();
            expect(text(dialog.query('parental-lock-pin-error'))).toBe(
                KEYS.hint
            );
            expect(pin()?.getAttribute('aria-invalid')).toBe('true');
            expect(document.activeElement).toBe(pin());

            await dialog.type('parental-lock-pin', '246');
            expect(dialog.query('parental-lock-pin-error')).toBeNull();
        });
    });

    describe('unlock mode', () => {
        it('has no repeat field and leaves autocomplete off', async () => {
            const dialog = await openDialog({ mode: 'unlock' });

            expect(dialog.query('parental-lock-pin-confirm')).toBeNull();
            expect(
                dialog.query('parental-lock-pin')?.getAttribute('autocomplete')
            ).toBe('off');
        });

        it('marks the PIN field invalid after a wrong PIN and unlocks with the right one', async () => {
            const verify = jest.fn(async (pin: string) => pin === '2468');
            const dialog = await openDialog({ mode: 'unlock', verify });
            const pin = () =>
                dialog.query<HTMLInputElement>('parental-lock-pin');

            await dialog.type('parental-lock-pin', '1357');
            await dialog.pressEnter();
            await dialog.fixture.whenStable();

            expect(text(dialog.query('parental-lock-pin-error'))).toBe(
                KEYS.wrongPin
            );
            expect(pin()?.getAttribute('aria-invalid')).toBe('true');
            expect(dialog.close).not.toHaveBeenCalled();

            await dialog.type('parental-lock-pin', '2468');
            expect(dialog.query('parental-lock-pin-error')).toBeNull();
            await dialog.pressEnter();
            expect(dialog.close).toHaveBeenCalledWith('2468');
        });

        it('does not verify an incomplete PIN', async () => {
            const verify = jest.fn(async () => true);
            const dialog = await openDialog({ mode: 'unlock', verify });

            await dialog.type('parental-lock-pin', '12');
            await dialog.pressEnter();

            expect(verify).not.toHaveBeenCalled();
            expect(text(dialog.query('parental-lock-pin-error'))).toBe(
                KEYS.hint
            );
        });
    });

    describe('cooldown', () => {
        const throttle = createParentalLockPinThrottle();
        const verify = jest.fn(async () => false);

        it('keeps the cooldown when the prompt is dismissed and opened again', async () => {
            const first = (
                await openDialog({ mode: 'unlock', verify, throttle })
            ).component;
            for (let i = 0; i < PARENTAL_LOCK_PIN_MAX_ATTEMPTS; i++) {
                first.onPinInput('0000');
                await first.submit();
            }
            expect(first.inCooldown()).toBe(true);
            expect(verify).toHaveBeenCalledTimes(
                PARENTAL_LOCK_PIN_MAX_ATTEMPTS
            );

            const reopened = (
                await openDialog({ mode: 'unlock', verify, throttle })
            ).component;
            expect(reopened.error()).toBe('PARENTAL_LOCK.PIN_DIALOG.COOLDOWN');
            reopened.onPinInput('0000');
            await reopened.submit();

            expect(reopened.inCooldown()).toBe(true);
            expect(verify).toHaveBeenCalledTimes(
                PARENTAL_LOCK_PIN_MAX_ATTEMPTS
            );
        });
    });
});

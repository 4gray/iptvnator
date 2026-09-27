import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    createParentalLockPinThrottle,
    PARENTAL_LOCK_PIN_MAX_ATTEMPTS,
} from '@iptvnator/shared/interfaces';
import { ParentalLockPinDialogComponent } from './parental-lock-pin-dialog.component';

describe('ParentalLockPinDialogComponent cooldown', () => {
    const throttle = createParentalLockPinThrottle();
    const verify = jest.fn(async () => false);

    function openDialog(): ParentalLockPinDialogComponent {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [
                ParentalLockPinDialogComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: { mode: 'unlock', verify, throttle },
                },
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
            ],
        });
        const fixture = TestBed.createComponent(ParentalLockPinDialogComponent);
        fixture.detectChanges();
        return fixture.componentInstance;
    }

    it('keeps the cooldown when the prompt is dismissed and opened again', async () => {
        const first = openDialog();
        for (let i = 0; i < PARENTAL_LOCK_PIN_MAX_ATTEMPTS; i++) {
            first.onPinInput('0000');
            await first.submit();
        }
        expect(first.inCooldown()).toBe(true);
        expect(verify).toHaveBeenCalledTimes(PARENTAL_LOCK_PIN_MAX_ATTEMPTS);

        const reopened = openDialog();
        expect(reopened.error()).toBe('PARENTAL_LOCK.PIN_DIALOG.COOLDOWN');
        reopened.onPinInput('0000');
        await reopened.submit();

        expect(reopened.inCooldown()).toBe(true);
        expect(verify).toHaveBeenCalledTimes(PARENTAL_LOCK_PIN_MAX_ATTEMPTS);
    });
});

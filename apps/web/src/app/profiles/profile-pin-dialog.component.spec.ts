import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
    ProfilePinDialogComponent,
    type ProfilePinDialogData,
} from './profile-pin-dialog.component';
import { fail, ok } from './profiles.stub';

function setup(submit: ProfilePinDialogData['submit']) {
    const close = jest.fn();
    TestBed.configureTestingModule({
        imports: [TranslateModule.forRoot(), ProfilePinDialogComponent],
        providers: [
            {
                provide: MAT_DIALOG_DATA,
                useValue: {
                    titleKey: 'T',
                    descriptionKey: 'D',
                    submitKey: 'S',
                    submit,
                } satisfies ProfilePinDialogData,
            },
            { provide: MatDialogRef, useValue: { close } },
        ],
    });
    const fixture = TestBed.createComponent(ProfilePinDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = async (pin: string) => {
        await fixture.whenStable();
        const input = el.querySelector<HTMLInputElement>(
            '[data-test-id="profile-pin-input"]'
        )!;
        input.value = pin;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await fixture.whenStable();
    };
    const submit_ = async () => {
        await fixture.componentInstance.submit();
        fixture.detectChanges();
    };
    const error = () =>
        el
            .querySelector('[data-test-id="profile-pin-error"]')
            ?.textContent?.trim();
    return { fixture, close, type, submit: submit_, error, el };
}

describe('ProfilePinDialogComponent', () => {
    afterEach(() => jest.useRealTimers());

    it('closes with true once the server accepted the PIN', async () => {
        const send = jest.fn(async () => ok(undefined));
        const { type, submit, close } = setup(send);
        await type('1234');
        await submit();
        expect(send).toHaveBeenCalledWith('1234');
        expect(close).toHaveBeenCalledWith(true);
    });

    it('refuses a malformed PIN without asking the server', async () => {
        const send = jest.fn();
        const { type, submit, error, close } = setup(send);
        await type('12');
        await submit();
        expect(send).not.toHaveBeenCalled();
        expect(error()).toContain('PROFILES.ERRORS.INVALID_PIN');
        expect(close).not.toHaveBeenCalled();
    });

    it('shows the wrong-PIN message and clears the field, keeping the dialog open', async () => {
        const { type, submit, error, close, fixture } = setup(async () =>
            fail({ code: 'wrong_pin' })
        );
        await type('1234');
        await submit();
        expect(error()).toContain('PROFILES.ERRORS.WRONG_PIN');
        expect(fixture.componentInstance.pin()).toBe('');
        expect(close).not.toHaveBeenCalled();
    });

    it('locks the field and counts down from retryAfter, then frees it', async () => {
        jest.useFakeTimers();
        const { type, submit, fixture, el } = setup(async () =>
            fail({ code: 'pin_locked', retryAfter: 3 })
        );
        await type('1234');
        await submit();
        const text = () => el.textContent;
        expect(fixture.componentInstance.locked()).toBe(true);
        expect(fixture.componentInstance.message()).toEqual({
            key: 'PROFILES.ERRORS.PIN_LOCKED',
            params: { seconds: 3 },
        });
        expect(
            el.querySelector<HTMLInputElement>(
                '[data-test-id="profile-pin-input"]'
            )!.disabled
        ).toBe(true);
        jest.advanceTimersByTime(2000);
        expect(fixture.componentInstance.message()?.params).toEqual({
            seconds: 1,
        });
        jest.advanceTimersByTime(1000);
        fixture.detectChanges();
        expect(fixture.componentInstance.locked()).toBe(false);
        expect(fixture.componentInstance.message()).toBeNull();
        expect(text()).not.toContain('PIN_LOCKED');
    });

    it('shows the rate limit with its countdown', async () => {
        jest.useFakeTimers();
        const { type, submit, fixture } = setup(async () =>
            fail({ code: 'pin_rate_limited', retryAfter: 20 })
        );
        await type('1234');
        await submit();
        expect(fixture.componentInstance.message()).toEqual({
            key: 'PROFILES.ERRORS.RATE_LIMITED',
            params: { seconds: 20 },
        });
    });

    it('never puts the PIN in the page, the logs or an error', async () => {
        const spies = (['log', 'warn', 'error', 'info'] as const).map((name) =>
            jest.spyOn(console, name).mockImplementation(() => undefined)
        );
        const { type, submit, el } = setup(async () =>
            fail({ code: 'wrong_pin' })
        );
        await type('987654');
        await submit();
        expect(el.textContent).not.toContain('987654');
        spies.forEach((spy) => {
            expect(JSON.stringify(spy.mock.calls)).not.toContain('987654');
            spy.mockRestore();
        });
    });

    it('closes without a result on cancel', () => {
        const { fixture, close } = setup(jest.fn());
        fixture.componentInstance.cancel();
        expect(close).toHaveBeenCalledWith(undefined);
    });
});

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ErrorStateMatcher } from '@angular/material/core';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import {
    createParentalLockPinThrottle,
    isValidParentalLockPin,
    ParentalLockPinThrottle,
    PARENTAL_LOCK_PIN_MAX_LENGTH,
    PARENTAL_LOCK_PIN_MIN_LENGTH,
} from '@iptvnator/shared/interfaces';

export type ParentalLockPinDialogMode = 'unlock' | 'set';

type PinDialogField = 'pin' | 'confirmation';

export interface ParentalLockPinDialogData {
    mode: ParentalLockPinDialogMode;
    /** Unlock only: whether the typed PIN is the right one. */
    verify?: (pin: string) => Promise<boolean>;
    /**
     * Unlock only: wrong-PIN count and cooldown owned by the caller, so a
     * dismissed and reopened prompt keeps them. A local one is used when
     * absent.
     */
    throttle?: ParentalLockPinThrottle;
    titleKey?: string;
    descriptionKey?: string;
    /** The flow's verb on the submit button; defaults to the mode's. */
    submitKey?: string;
}

/**
 * PIN prompt for the parental lock. Pure UI: the caller supplies `verify`
 * for the unlock mode and receives the accepted PIN (or `undefined` when
 * dismissed) through the dialog result. `set` mode asks for the PIN twice.
 *
 * Submit stays enabled while the input is incomplete: implicit submission
 * (Enter) does nothing on a disabled default button, so an invalid entry
 * is refused by `submit()` with an error on the field instead.
 */
@Component({
    selector: 'app-parental-lock-pin-dialog',
    templateUrl: './parental-lock-pin-dialog.component.html',
    styleUrl: './parental-lock-pin-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        TranslatePipe,
    ],
})
export class ParentalLockPinDialogComponent {
    readonly data = inject<ParentalLockPinDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<ParentalLockPinDialogComponent, string | undefined>
    );
    private readonly pinInput =
        viewChild<ElementRef<HTMLInputElement>>('pinInput');
    private readonly confirmationInput =
        viewChild<ElementRef<HTMLInputElement>>('confirmationInput');

    readonly minLength = PARENTAL_LOCK_PIN_MIN_LENGTH;
    readonly maxLength = PARENTAL_LOCK_PIN_MAX_LENGTH;
    readonly pin = signal('');
    readonly confirmation = signal('');
    readonly busy = signal(false);
    /** Wrong PIN or cooldown, shown on the PIN field. */
    readonly error = signal<string | null>(null);
    readonly shake = signal<PinDialogField | null>(null);
    readonly cooldownUntil = signal(0);
    /** A submit was refused for this field; cleared when it is edited. */
    private readonly refused = signal<PinDialogField | null>(null);
    private readonly throttle =
        this.data.throttle ?? createParentalLockPinThrottle();
    private cooldownTimer: number | null = null;
    private shakeTimer: number | null = null;

    readonly isSetMode = computed(() => this.data.mode === 'set');
    readonly titleKey = computed(
        () =>
            this.data.titleKey ??
            (this.isSetMode()
                ? 'PARENTAL_LOCK.PIN_DIALOG.SET_TITLE'
                : 'PARENTAL_LOCK.PIN_DIALOG.UNLOCK_TITLE')
    );
    readonly descriptionKey = computed(
        () =>
            this.data.descriptionKey ??
            (this.isSetMode()
                ? 'PARENTAL_LOCK.PIN_DIALOG.SET_DESCRIPTION'
                : 'PARENTAL_LOCK.PIN_DIALOG.UNLOCK_DESCRIPTION')
    );
    readonly submitKey = computed(
        () =>
            this.data.submitKey ??
            (this.isSetMode()
                ? 'PARENTAL_LOCK.PIN_DIALOG.SAVE'
                : 'PARENTAL_LOCK.PIN_DIALOG.UNLOCK')
    );
    readonly inCooldown = computed(() => this.cooldownUntil() > Date.now());
    /** The message under the PIN field, if any. */
    readonly pinErrorKey = computed(
        () =>
            this.error() ??
            (this.refused() === 'pin' && !isValidParentalLockPin(this.pin())
                ? 'PARENTAL_LOCK.PIN_DIALOG.PIN_HINT'
                : null)
    );
    /**
     * Set mode: the repeat differs from the PIN. Shown while typing once the
     * repeat is as long as the PIN, and at any length after a refused submit.
     */
    readonly mismatch = computed(() => {
        const confirmation = this.confirmation();
        const pin = this.pin();
        if (!this.isSetMode() || confirmation === pin) {
            return false;
        }
        return (
            this.refused() === 'confirmation' ||
            (confirmation.length > 0 && confirmation.length >= pin.length)
        );
    });
    readonly pinErrorState: ErrorStateMatcher = {
        isErrorState: () => this.pinErrorKey() !== null,
    };
    readonly confirmationErrorState: ErrorStateMatcher = {
        isErrorState: () => this.mismatch(),
    };

    constructor() {
        // Reopened during a cooldown: the pause carries on where it was.
        const until = this.throttle.cooldownUntil();
        if (until > 0) {
            this.startCooldown(until);
            this.error.set('PARENTAL_LOCK.PIN_DIALOG.COOLDOWN');
        }
    }

    static open(
        dialog: MatDialog,
        data: ParentalLockPinDialogData
    ): MatDialogRef<ParentalLockPinDialogComponent, string | undefined> {
        return dialog.open(ParentalLockPinDialogComponent, {
            data,
            width: '400px',
            maxWidth: 'calc(100vw - 32px)',
            autoFocus: 'input',
            restoreFocus: true,
        });
    }

    onPinInput(value: string): void {
        this.pin.set(value.replace(/\D/g, '').slice(0, this.maxLength));
        this.error.set(null);
        this.clearRefusal('pin');
    }

    onConfirmationInput(value: string): void {
        this.confirmation.set(
            value.replace(/\D/g, '').slice(0, this.maxLength)
        );
        this.clearRefusal('confirmation');
    }

    /**
     * Set mode: Enter after a complete first PIN moves on to an empty repeat
     * instead of submitting. Handled on the key, not in `submit()`: focus
     * cannot tell Enter from a click on Save, as WebKit does not focus a
     * clicked button.
     */
    onPinEnter(event: Event): void {
        if (
            this.isSetMode() &&
            !this.confirmation() &&
            isValidParentalLockPin(this.pin())
        ) {
            event.preventDefault();
            this.confirmationInput()?.nativeElement.focus();
        }
    }

    async submit(): Promise<void> {
        if (this.busy() || this.inCooldown()) {
            return;
        }
        const pin = this.pin();
        if (!isValidParentalLockPin(pin)) {
            this.error.set(null);
            this.refuse('pin');
            return;
        }
        if (this.isSetMode()) {
            if (this.confirmation() !== pin) {
                this.refuse('confirmation');
                return;
            }
            this.dialogRef.close(pin);
            return;
        }

        this.busy.set(true);
        try {
            const accepted = (await this.data.verify?.(pin)) === true;
            if (accepted) {
                this.throttle.recordSuccess();
                this.dialogRef.close(pin);
                return;
            }
            this.pin.set('');
            if (this.throttle.recordFailure()) {
                this.startCooldown(this.throttle.cooldownUntil());
                this.error.set('PARENTAL_LOCK.PIN_DIALOG.COOLDOWN');
            } else {
                this.error.set('PARENTAL_LOCK.PIN_DIALOG.WRONG_PIN');
            }
            this.shakeField('pin');
        } finally {
            this.busy.set(false);
            queueMicrotask(() => this.pinInput()?.nativeElement.focus());
        }
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }

    /** Shows the field's error, shakes it and moves focus to it. */
    private refuse(field: PinDialogField): void {
        this.refused.set(field);
        this.shakeField(field);
        this.fieldInput(field)?.focus();
    }

    private fieldInput(field: PinDialogField): HTMLInputElement | undefined {
        return (field === 'pin' ? this.pinInput() : this.confirmationInput())
            ?.nativeElement;
    }

    private clearRefusal(field: PinDialogField): void {
        if (this.refused() === field) {
            this.refused.set(null);
        }
    }

    private shakeField(field: PinDialogField): void {
        // A refusal inside the previous one's 400ms shakes for its own
        // full time; the earlier timer would otherwise end it early.
        if (this.shakeTimer !== null) {
            window.clearTimeout(this.shakeTimer);
        }
        if (this.shake() === field) {
            // Same field again: its class stays on, so the running shake
            // would only finish. Rewind it (none under reduced motion).
            this.fieldInput(field)
                ?.closest('mat-form-field')
                ?.getAnimations?.()
                .filter((animation) =>
                    (animation as CSSAnimation).animationName?.includes(
                        'pin-dialog-shake'
                    )
                )
                .forEach((animation) => (animation.currentTime = 0));
        }
        this.shake.set(field);
        this.shakeTimer = window.setTimeout(() => {
            this.shakeTimer = null;
            this.shake.set(null);
        }, 400);
    }

    private startCooldown(until: number): void {
        this.cooldownUntil.set(until);
        if (this.cooldownTimer !== null) {
            window.clearTimeout(this.cooldownTimer);
        }
        this.cooldownTimer = window.setTimeout(
            () => {
                this.cooldownTimer = null;
                // `inCooldown` compares against the clock only when a signal it
                // reads changes; resetting the deadline is that change.
                this.cooldownUntil.set(0);
                this.error.set(null);
            },
            Math.max(0, until - Date.now())
        );
    }
}

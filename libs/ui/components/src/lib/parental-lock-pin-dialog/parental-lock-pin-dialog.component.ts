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
}

/**
 * PIN prompt for the parental lock. Pure UI: the caller supplies `verify`
 * for the unlock mode and receives the accepted PIN (or `undefined` when
 * dismissed) through the dialog result. `set` mode asks for the PIN twice.
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

    readonly minLength = PARENTAL_LOCK_PIN_MIN_LENGTH;
    readonly maxLength = PARENTAL_LOCK_PIN_MAX_LENGTH;
    readonly pin = signal('');
    readonly confirmation = signal('');
    readonly busy = signal(false);
    readonly error = signal<string | null>(null);
    readonly shake = signal(false);
    readonly cooldownUntil = signal(0);
    private readonly throttle =
        this.data.throttle ?? createParentalLockPinThrottle();
    private cooldownTimer: number | null = null;

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
    readonly inCooldown = computed(() => this.cooldownUntil() > Date.now());
    readonly canSubmit = computed(
        () =>
            !this.busy() &&
            !this.inCooldown() &&
            isValidParentalLockPin(this.pin()) &&
            (!this.isSetMode() || this.confirmation() === this.pin())
    );

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
    }

    onConfirmationInput(value: string): void {
        this.confirmation.set(
            value.replace(/\D/g, '').slice(0, this.maxLength)
        );
        this.error.set(null);
    }

    async submit(): Promise<void> {
        if (!this.canSubmit()) {
            if (this.isSetMode() && this.confirmation() !== this.pin()) {
                this.fail('PARENTAL_LOCK.PIN_DIALOG.MISMATCH');
            }
            return;
        }
        const pin = this.pin();
        if (this.isSetMode()) {
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
                this.fail('PARENTAL_LOCK.PIN_DIALOG.COOLDOWN');
            } else {
                this.fail('PARENTAL_LOCK.PIN_DIALOG.WRONG_PIN');
            }
        } finally {
            this.busy.set(false);
            queueMicrotask(() => this.pinInput()?.nativeElement.focus());
        }
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }

    private fail(messageKey: string): void {
        this.error.set(messageKey);
        this.shake.set(true);
        window.setTimeout(() => this.shake.set(false), 400);
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

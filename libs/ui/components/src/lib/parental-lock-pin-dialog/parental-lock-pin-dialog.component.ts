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
    isValidParentalLockPin,
    PARENTAL_LOCK_PIN_MAX_LENGTH,
    PARENTAL_LOCK_PIN_MIN_LENGTH,
} from '@iptvnator/shared/interfaces';

export type ParentalLockPinDialogMode = 'unlock' | 'set';

export interface ParentalLockPinDialogData {
    mode: ParentalLockPinDialogMode;
    /** Unlock only: whether the typed PIN is the right one. */
    verify?: (pin: string) => Promise<boolean>;
    titleKey?: string;
    descriptionKey?: string;
}

/** Failed attempts before the prompt pauses for {@link COOLDOWN_MS}. */
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

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
    private failedAttempts = 0;
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
                this.dialogRef.close(pin);
                return;
            }
            this.failedAttempts += 1;
            this.pin.set('');
            if (this.failedAttempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
                this.failedAttempts = 0;
                this.startCooldown();
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

    private startCooldown(): void {
        this.cooldownUntil.set(Date.now() + COOLDOWN_MS);
        if (this.cooldownTimer !== null) {
            window.clearTimeout(this.cooldownTimer);
        }
        this.cooldownTimer = window.setTimeout(() => {
            this.cooldownTimer = null;
            // `inCooldown` compares against the clock only when a signal it
            // reads changes; resetting the deadline is that change.
            this.cooldownUntil.set(0);
            this.error.set(null);
        }, COOLDOWN_MS);
    }
}

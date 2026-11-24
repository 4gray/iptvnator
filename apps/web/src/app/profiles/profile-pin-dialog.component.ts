import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    computed,
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
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import type { ProfilesResult } from '@iptvnator/services/profiles';
import {
    isValidParentalLockPin,
    PARENTAL_LOCK_PIN_MAX_LENGTH,
    PARENTAL_LOCK_PIN_MIN_LENGTH,
} from '@iptvnator/shared/interfaces';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/dialog';
import { dialogSize } from '@iptvnator/ui/dialog/dialog-size';
import {
    profileErrorMessage,
    retryAfterSeconds,
    type ProfileErrorMessage,
} from './profile-error-message';

export interface ProfilePinDialogData {
    readonly titleKey: string;
    readonly descriptionKey: string;
    readonly submitKey: string;
    readonly titleParams?: Readonly<Record<string, string>>;
    /**
     * Sends the PIN to the server and reports what it answered. The dialog
     * stays open on a failure and shows the mapped message; it never keeps
     * or logs the PIN.
     */
    readonly submit: (pin: string) => Promise<ProfilesResult<unknown>>;
}

/**
 * Asks for a profile PIN and lets the server judge it: a wrong PIN, a
 * lockout with a countdown and the request rate limit each show their own
 * message. Closes with `true` once the server accepted the PIN.
 */
@Component({
    selector: 'app-profile-pin-dialog',
    providers: [provideFormFieldDefaults()],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './profile-pin-dialog.component.html',
    styleUrl: './profile-pin-dialog.component.scss',
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        FormsModule,
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        TranslatePipe,
    ],
})
export class ProfilePinDialogComponent {
    readonly data = inject<ProfilePinDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<ProfilePinDialogComponent, boolean>
    );
    private readonly pinInput =
        viewChild<ElementRef<HTMLInputElement>>('pinInput');
    private timer: ReturnType<typeof setInterval> | null = null;

    readonly minLength = PARENTAL_LOCK_PIN_MIN_LENGTH;
    readonly maxLength = PARENTAL_LOCK_PIN_MAX_LENGTH;
    readonly pin = signal('');
    readonly busy = signal(false);
    readonly error = signal<ProfileErrorMessage | null>(null);
    /** Seconds left of a lock or rate limit; 0 when none. */
    readonly waitSeconds = signal(0);
    readonly locked = computed(() => this.waitSeconds() > 0);
    private readonly lockKey = signal<string | null>(null);
    /** While counting down, the message follows the clock. */
    readonly message = computed<ProfileErrorMessage | null>(() => {
        const key = this.lockKey();
        return key && this.locked()
            ? { key, params: { seconds: this.waitSeconds() } }
            : this.error();
    });

    constructor() {
        inject(DestroyRef).onDestroy(() => this.stopTimer());
    }

    static open(
        dialog: MatDialog,
        data: ProfilePinDialogData
    ): MatDialogRef<ProfilePinDialogComponent, boolean | undefined> {
        return dialog.open(ProfilePinDialogComponent, {
            ...dialogSize('sm'),
            data,
            autoFocus: 'input',
            restoreFocus: true,
        });
    }

    onPinInput(value: string): void {
        this.pin.set(value.replace(/\D/g, '').slice(0, this.maxLength));
        if (!this.locked()) this.error.set(null);
    }

    async submit(): Promise<void> {
        if (this.busy() || this.locked()) return;
        const pin = this.pin();
        if (!isValidParentalLockPin(pin)) {
            this.error.set({ key: 'PROFILES.ERRORS.INVALID_PIN' });
            return;
        }
        this.busy.set(true);
        try {
            const result = await this.data.submit(pin);
            if (result.ok) {
                this.dialogRef.close(true);
                return;
            }
            this.pin.set('');
            const message = profileErrorMessage(result.error);
            const seconds = retryAfterSeconds(result.error);
            if (seconds) {
                this.error.set(null);
                this.lockKey.set(message.key);
                this.startCountdown(seconds);
            } else {
                this.error.set(message);
            }
        } finally {
            this.busy.set(false);
            queueMicrotask(() => this.pinInput()?.nativeElement.focus());
        }
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }

    private startCountdown(seconds: number): void {
        this.stopTimer();
        this.waitSeconds.set(seconds);
        this.timer = setInterval(() => {
            const left = this.waitSeconds() - 1;
            this.waitSeconds.set(Math.max(0, left));
            if (left <= 0) {
                this.stopTimer();
                this.lockKey.set(null);
            }
        }, 1000);
    }

    private stopTimer(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }
}

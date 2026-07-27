import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import {
    NonNullableFormBuilder,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

export interface StalkerCredentialsDialogData {
    readonly savedCredentialsRejected: boolean;
    readonly username?: string;
}

export interface StalkerCredentialsDialogResult {
    readonly username: string;
    readonly password: string;
}

@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
    selector: 'app-stalker-credentials-dialog',
    styles: `
        form,
        .credential-fields {
            display: grid;
        }

        .credential-fields {
            gap: 0.75rem;
            min-width: min(24rem, 72vw);
            padding-top: 0.5rem;
        }

        .rejected {
            color: var(--mat-sys-error);
        }
    `,
    template: `
        <h2 mat-dialog-title>
            {{ 'HOME.STALKER_PORTAL.CREDENTIALS_TITLE' | translate }}
        </h2>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <mat-dialog-content>
                <p>
                    {{
                        'HOME.STALKER_PORTAL.CREDENTIALS_DESCRIPTION'
                            | translate
                    }}
                </p>
                @if (data.savedCredentialsRejected) {
                    <p class="rejected" role="alert">
                        {{
                            'HOME.STALKER_PORTAL.CREDENTIALS_REJECTED'
                                | translate
                        }}
                    </p>
                }
                <div class="credential-fields">
                    <mat-form-field appearance="outline">
                        <mat-label>
                            {{ 'HOME.STALKER_PORTAL.USERNAME' | translate }}
                        </mat-label>
                        <input
                            matInput
                            autocomplete="username"
                            formControlName="username"
                        />
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                        <mat-label>
                            {{ 'HOME.STALKER_PORTAL.PASSWORD' | translate }}
                        </mat-label>
                        <input
                            matInput
                            autocomplete="current-password"
                            formControlName="password"
                            [type]="passwordVisible() ? 'text' : 'password'"
                        />
                        <button
                            mat-icon-button
                            matSuffix
                            type="button"
                            [attr.aria-label]="
                                (passwordVisible()
                                    ? 'HOME.STALKER_PORTAL.HIDE_PASSWORD'
                                    : 'HOME.STALKER_PORTAL.SHOW_PASSWORD'
                                ) | translate
                            "
                            (click)="passwordVisible.update(visible => !visible)"
                        >
                            <mat-icon aria-hidden="true">
                                {{
                                    passwordVisible()
                                        ? 'visibility_off'
                                        : 'visibility'
                                }}
                            </mat-icon>
                        </button>
                    </mat-form-field>
                </div>
            </mat-dialog-content>
            <mat-dialog-actions align="end">
                <button mat-button type="button" (click)="cancel()">
                    {{ 'CANCEL' | translate }}
                </button>
                <button mat-flat-button type="submit">
                    {{ 'HOME.STALKER_PORTAL.VALIDATE_CREDENTIALS' | translate }}
                </button>
            </mat-dialog-actions>
        </form>
    `,
})
export class StalkerCredentialsDialogComponent {
    private readonly dialogRef =
        inject<
            MatDialogRef<
                StalkerCredentialsDialogComponent,
                StalkerCredentialsDialogResult | null
            >
        >(MatDialogRef);
    private readonly formBuilder = inject(NonNullableFormBuilder);
    readonly data = inject<StalkerCredentialsDialogData>(MAT_DIALOG_DATA);
    readonly passwordVisible = signal(false);
    readonly form = this.formBuilder.group({
        username: [
            this.data.username ?? '',
            [Validators.required, Validators.pattern(/\S/)],
        ],
        password: [''],
    });

    submit(): void {
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }
        const value = this.form.getRawValue();
        this.dialogRef.close({
            password: value.password,
            username: value.username,
        });
    }

    cancel(): void {
        this.dialogRef.close(null);
    }
}

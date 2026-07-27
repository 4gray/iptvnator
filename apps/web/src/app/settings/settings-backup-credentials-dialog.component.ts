import { Component, inject } from '@angular/core';
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
import { MatInputModule } from '@angular/material/input';
import { PlaylistBackupXtreamCredentials } from '@iptvnator/services';
import { TranslateModule } from '@ngx-translate/core';

export interface SettingsBackupCredentialsDialogData {
    playlistTitle: string;
    serverHost: string;
}

@Component({
    selector: 'app-settings-backup-credentials-dialog',
    templateUrl: './settings-backup-credentials-dialog.component.html',
    styleUrls: ['./settings-backup-credentials-dialog.component.scss'],
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
})
export class SettingsBackupCredentialsDialogComponent {
    private readonly dialogRef =
        inject<
            MatDialogRef<
                SettingsBackupCredentialsDialogComponent,
                PlaylistBackupXtreamCredentials | null
            >
        >(MatDialogRef);
    private readonly formBuilder = inject(NonNullableFormBuilder);

    readonly dialogData =
        inject<SettingsBackupCredentialsDialogData>(MAT_DIALOG_DATA);

    readonly credentialsForm = this.formBuilder.group({
        username: ['', [Validators.required, Validators.pattern(/\S/)]],
        password: ['', [Validators.required, Validators.pattern(/\S/)]],
    });

    submit(): void {
        if (this.credentialsForm.invalid) {
            this.credentialsForm.markAllAsTouched();
            return;
        }

        const { username, password } = this.credentialsForm.getRawValue();
        this.dialogRef.close({
            username: username.trim(),
            password,
        });
    }

    skip(): void {
        this.dialogRef.close(null);
    }
}

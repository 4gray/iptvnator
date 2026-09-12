import { Component, EventEmitter, Output, inject } from '@angular/core';
import {
    AbstractControl,
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    ValidationErrors,
    Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { createXtreamConnectionTestState } from '@iptvnator/services';
import {
    createRandomId,
    extractXtreamCredentialsFromUrl,
    normalizeXtreamServerUrl,
    Playlist,
} from '@iptvnator/shared/interfaces';

function xtreamServerUrlValidator(
    control: AbstractControl
): ValidationErrors | null {
    const value = control.value;
    if (typeof value !== 'string' || value.trim().length === 0) {
        return null;
    }

    try {
        normalizeXtreamServerUrl(value);
        return null;
    } catch {
        return { xtreamServerUrl: true };
    }
}

@Component({
    imports: [
        FormsModule,
        MatFormFieldModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
    selector: 'app-xtream-code-import',
    templateUrl: './xtream-code-import.component.html',
    styles: [
        `
            :host {
                display: flex;
                margin: 10px;
                justify-content: center;
            }

            form {
                width: 100%;
            }
        `,
    ],
})
export class XtreamCodeImportComponent {
    @Output() addClicked = new EventEmitter<void>();
    URL_REGEX = /^\s*https?:\/\/[^ "]+\s*$/;

    form = new FormGroup({
        _id: new FormControl(createRandomId()),
        title: new FormControl('', [Validators.required]),
        password: new FormControl('', [Validators.required]),
        username: new FormControl('', [Validators.required]),
        serverUrl: new FormControl('', [
            Validators.required,
            Validators.pattern(this.URL_REGEX),
            xtreamServerUrlValidator,
        ]),
        importDate: new FormControl(new Date().toISOString()),
    });

    readonly store = inject(Store);
    readonly connectionTest = createXtreamConnectionTestState(this.form);

    get isTestingConnection(): boolean {
        return this.connectionTest.testing();
    }

    testConnection(): Promise<void> {
        return this.connectionTest.test();
    }

    clearForm(): void {
        this.form.reset({
            _id: createRandomId(),
            title: '',
            password: '',
            username: '',
            serverUrl: '',
            importDate: new Date().toISOString(),
        });
    }

    addPlaylist() {
        if (!this.form.valid || this.isTestingConnection) return;

        const connection = this.getNormalizedConnection();
        if (!connection) {
            return;
        }

        this.store.dispatch(
            PlaylistActions.addPlaylist({
                playlist: {
                    ...this.form.value,
                    password: connection.password,
                    serverUrl: connection.serverUrl,
                    username: connection.username,
                } as Playlist,
            })
        );
        this.addClicked.emit();
    }

    extractParams(urlAsString: string): void {
        if (
            this.form.get('username')?.value !== '' ||
            this.form.get('password')?.value !== ''
        )
            return;
        try {
            const credentials = extractXtreamCredentialsFromUrl(urlAsString);
            if (!credentials) {
                return;
            }

            this.form.get('username')?.setValue(credentials.username);
            this.form.get('password')?.setValue(credentials.password);
        } catch (error) {
            console.error('Invalid URL', error);
        }
    }

    private getNormalizedConnection(): {
        password: string;
        serverUrl: string;
        username: string;
    } | null {
        try {
            return {
                password: (this.form.value.password as string).trim(),
                serverUrl: normalizeXtreamServerUrl(
                    this.form.value.serverUrl as string
                ),
                username: (this.form.value.username as string).trim(),
            };
        } catch {
            return null;
        }
    }
}

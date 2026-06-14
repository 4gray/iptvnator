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
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PortalStatus, PortalStatusService } from '@iptvnator/services';
import {
    extractXtreamCredentialsFromUrl,
    normalizeXtreamServerUrl,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { v4 as uuid } from 'uuid';

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
        MatIcon,
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

            .status-active {
                color: #4caf50;
            }

            .status-inactive {
                color: #f44336;
            }

            .status-expired {
                color: #ff9800;
            }

            .status-unavailable {
                color: #9e9e9e;
            }

            .connection-status {
                margin: 10px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }
        `,
    ],
})
export class XtreamCodeImportComponent {
    @Output() addClicked = new EventEmitter<void>();
    URL_REGEX = /^\s*https?:\/\/[^ "]+\s*$/;

    form = new FormGroup({
        _id: new FormControl(uuid()),
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
    readonly portalStatusService = inject(PortalStatusService);

    connectionStatus: PortalStatus | null = null;
    isTestingConnection = false;

    async testConnection(): Promise<void> {
        if (!this.form.valid) return;

        const connection = this.getNormalizedConnection();
        if (!connection) {
            this.connectionStatus = 'unavailable';
            return;
        }

        this.isTestingConnection = true;
        try {
            // User-initiated connection test — bypass the shared cache so the
            // result reflects the portal's current state, not whatever was
            // cached up to 30 s ago by another component.
            this.connectionStatus =
                await this.portalStatusService.checkPortalStatus(
                    connection.serverUrl,
                    connection.username,
                    connection.password,
                    { skipCache: true }
                );
        } finally {
            this.isTestingConnection = false;
        }
    }

    getStatusMessage(): string {
        return this.portalStatusService.getStatusMessage(this.connectionStatus);
    }

    getStatusClass(): string {
        return this.portalStatusService.getStatusClass(this.connectionStatus);
    }

    getStatusIcon(): string {
        return this.portalStatusService.getStatusIcon(this.connectionStatus);
    }

    clearForm(): void {
        this.form.reset({
            _id: uuid(),
            title: '',
            password: '',
            username: '',
            serverUrl: '',
            importDate: new Date().toISOString(),
        });
        this.connectionStatus = null;
    }

    addPlaylist() {
        if (!this.form.valid) return;

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

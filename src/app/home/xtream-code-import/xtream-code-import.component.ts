import { Component, EventEmitter, Output, inject } from '@angular/core';
import {
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { v4 as uuid } from 'uuid';
import { Playlist } from '../../../../shared/playlist.interface';
import {
    PortalStatus,
    PortalStatusService,
} from '../../services/portal-status.service';
import { addPlaylist } from '../../state/actions';

@Component({
    imports: [
        FormsModule,
        MatButton,
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
                max-width: 600px;
            }

            .form-header {
                text-align: center;
                margin-bottom: 24px;
            }

            .form-header h3 {
                margin: 0 0 8px 0;
                color: #1976d2;
                font-size: 24px;
            }

            .form-subtitle {
                margin: 0;
                color: #666;
                font-size: 14px;
            }

            .full-width {
                width: 100%;
                margin-bottom: 16px;
            }

            .quick-fill-section {
                margin: 24px 0;
                padding: 16px;
                background: #f5f5f5;
                border-radius: 8px;
            }

            .quick-fill-section h4 {
                margin: 0 0 12px 0;
                color: #333;
                font-size: 16px;
            }

            .quick-fill-buttons {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }

            .quick-fill-btn {
                min-width: 120px;
                border-color: #1976d2;
                color: #1976d2;
            }

            .quick-fill-btn:hover {
                background: #e3f2fd;
            }

            .button-row {
                display: flex;
                gap: 16px;
                margin: 24px 0;
                justify-content: center;
            }

            .test-btn {
                min-width: 140px;
            }

            .add-btn {
                min-width: 140px;
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

            .status-error {
                color: #f44336;
            }

            .connection-status {
                margin: 16px 0;
                padding: 12px;
                border-radius: 6px;
                background: #f5f5f5;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .help-section {
                margin-top: 24px;
                padding: 16px;
                background: #e3f2fd;
                border-radius: 8px;
                border-left: 4px solid #1976d2;
            }

            .help-section h4 {
                margin: 0 0 12px 0;
                color: #1976d2;
                font-size: 16px;
            }

            .help-section ul {
                margin: 0;
                padding-left: 20px;
            }

            .help-section li {
                margin-bottom: 8px;
                color: #333;
                font-size: 14px;
            }

            .help-section code {
                background: #fff;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 12px;
            }

            mat-form-field {
                margin-bottom: 16px;
            }

            mat-hint {
                font-size: 12px;
                color: #666;
            }
        `,
    ],
})
export class XtreamCodeImportComponent {
    @Output() addClicked = new EventEmitter<void>();
    URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

    form = new FormGroup({
        _id: new FormControl(uuid()),
        title: new FormControl('', [Validators.required]),
        password: new FormControl('', [Validators.required]),
        username: new FormControl('', [Validators.required]),
        serverUrl: new FormControl('', [
            Validators.required,
            Validators.pattern(this.URL_REGEX),
        ]),
        importDate: new FormControl(new Date().toISOString()),
    });

    readonly store = inject(Store);
    readonly portalStatusService = inject(PortalStatusService);

    connectionStatus: PortalStatus | null = null;
    isTestingConnection = false;

    async testConnection(): Promise<void> {
        if (!this.form.valid) return;

        this.isTestingConnection = true;
        this.connectionStatus = null;

        try {
            const status = await this.portalStatusService.checkPortalStatus(
                this.form.value.serverUrl!,
                this.form.value.username!,
                this.form.value.password!
            );
            this.connectionStatus = status;
        } catch (error) {
            console.error('Connection test failed:', error);
            this.connectionStatus = 'unavailable';
        } finally {
            this.isTestingConnection = false;
        }
    }

    /**
     * Quick fill examples for common IPTV providers
     */
    fillExample(type: 'ruvoplay' | 'iptv'): void {
        if (type === 'ruvoplay') {
            this.form.patchValue({
                title: 'Ruvo Play IPTV',
                serverUrl: 'http://ruvoplay.online',
                username: 'RuvoTest',
                password: 'a1cba53d1b'
            });
        } else if (type === 'iptv') {
            this.form.patchValue({
                title: 'My IPTV Provider',
                serverUrl: 'http://your-server.com',
                username: 'your_username',
                password: 'your_password'
            });
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

    addPlaylist() {
        const serverUrlAsString = this.form.value.serverUrl as string;
        const url = new URL(serverUrlAsString);
        const serverUrl = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
        this.store.dispatch(
            addPlaylist({
                playlist: {
                    ...this.form.value,
                    serverUrl,
                } as Playlist,
            })
        );
        this.addClicked.emit();
    }

    extractParams(urlAsString: string): void {
        if (
            this.form.get('username').value !== '' ||
            this.form.get('password').value !== ''
        )
            return;
        try {
            // Create a new URL object from the complete link
            const url = new URL(urlAsString);

            // Extract username and password from query parameters
            const username = url.searchParams.get('username') || '';
            const password = url.searchParams.get('password') || '';

            this.form.get('username')?.setValue(username);
            this.form.get('password')?.setValue(password);
        } catch (error) {
            console.error('Invalid URL', error);
        }
    }
}

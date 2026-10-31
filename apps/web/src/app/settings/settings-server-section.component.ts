import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
    FormControl,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { SettingsActivitySectionComponent } from './settings-activity-section.component';
import { createRandomId, type Playlist } from '@iptvnator/shared/interfaces';
import {
    normalizeSourceServerUrl,
    sourceFromPlaylist,
} from '@iptvnator/shared/interfaces/source-definition';
import {
    SourceSyncService,
    assertSourceInstance,
    saveBrowserSourceConnection,
    disconnectBrowserSourceConnection,
    readLocalSourcesForImport,
    requestSourceServer,
} from '@iptvnator/services/source-sync';

@Component({
    selector: 'app-settings-server-section',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [provideFormFieldDefaults()],
    imports: [
        SettingsActivitySectionComponent,
        DatePipe,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        TranslateModule,
    ],
    templateUrl: './settings-server-section.component.html',
    styles: [
        `
            :host {
                display: block;
            }
            .server-fields {
                display: grid;
                gap: 16px;
                padding: 20px;
            }
            .server-actions {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }
            .server-message {
                margin: 0;
                color: var(--app-eyebrow-color);
                overflow-wrap: anywhere;
            }
            .server-help {
                display: inline-block;
                margin-top: 8px;
                color: var(--app-selection-text-color);
                text-underline-offset: 3px;
            }
            button,
            input,
            a {
                app-region: no-drag;
            }
        `,
    ],
})
export class SettingsServerSectionComponent {
    readonly sync = inject(SourceSyncService);
    readonly busy = signal(false);
    readonly connecting = signal(false);
    readonly message = signal('');
    readonly preview = signal<Playlist[] | null>(null);
    readonly urlControl = new FormControl(this.sync.connection?.apiUrl ?? '', {
        nonNullable: true,
        validators: [
            Validators.required,
            (control) => {
                try {
                    normalizeSourceServerUrl(control.value.trim());
                    return null;
                } catch {
                    return { serverUrl: true };
                }
            },
        ],
    });
    token = '';

    async connect(): Promise<void> {
        if (this.busy()) return;
        this.message.set('');
        this.urlControl.markAsTouched();
        if (this.urlControl.invalid) return;
        this.busy.set(true);
        this.connecting.set(true);
        try {
            const input = this.urlControl.value.trim().replace(/\/+$/, '');
            const apiUrl =
                input === this.sync.connection?.apiUrl
                    ? input
                    : normalizeSourceServerUrl(input);
            if (window.electron?.sourceSyncConfigure) {
                await window.electron.sourceSyncConfigure(
                    apiUrl,
                    this.token,
                    true
                );
                this.token = '';
            } else {
                const response = await fetch(`${apiUrl}/v1/instance`, {
                    redirect: 'error',
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok)
                    throw new Error(
                        [401, 403].includes(response.status)
                            ? 'SOURCE_SYNC.LOCKED'
                            : 'SOURCE_SYNC.CONNECTION_FAILED'
                    );
                const instance: unknown = await response.json().catch(() => {
                    throw new Error('SOURCE_SYNC.INCOMPATIBLE');
                });
                assertSourceInstance(instance);
                const check = await fetch(`${apiUrl}/v1/sources`, {
                    headers: this.token
                        ? { Authorization: `Bearer ${this.token}` }
                        : {},
                    redirect: 'error',
                    signal: AbortSignal.timeout(10000),
                });
                if (!check.ok)
                    throw new Error(
                        [401, 403].includes(check.status)
                            ? 'SOURCE_SYNC.LOCKED'
                            : 'SOURCE_SYNC.CONNECTION_FAILED'
                    );
                saveBrowserSourceConnection(
                    { apiUrl, instanceId: instance.instanceId! },
                    this.token
                );
                this.token = '';
                location.reload();
            }
        } catch (error) {
            this.showError(error, 'SOURCE_SYNC.CONNECTION_FAILED');
        } finally {
            this.busy.set(false);
            this.connecting.set(false);
        }
    }

    async disconnect(): Promise<void> {
        this.busy.set(true);
        try {
            if (window.electron?.sourceSyncDisconnect)
                await window.electron.sourceSyncDisconnect();
            else {
                if (!disconnectBrowserSourceConnection())
                    throw new Error('SOURCE_SYNC.REQUEST_FAILED');
                location.reload();
            }
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    async previewImport(): Promise<void> {
        this.busy.set(true);
        try {
            this.preview.set(await readLocalSourcesForImport());
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    async importSources(): Promise<void> {
        this.busy.set(true);
        this.message.set('');
        try {
            for (const playlist of this.preview() ?? []) {
                const source = {
                    ...sourceFromPlaylist(playlist),
                    id: createRandomId(),
                };
                const response = await requestSourceServer({
                    operation: 'create',
                    id: source.id,
                    source,
                });
                if (response.status >= 400)
                    throw new Error('SOURCE_SYNC.IMPORT_FAILED');
            }
            await this.sync.refresh();
            this.preview.set(null);
            this.message.set('SOURCE_SYNC.IMPORTED');
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    private showError(
        error: unknown,
        fallback = 'SOURCE_SYNC.REQUEST_FAILED'
    ): void {
        const key =
            error instanceof Error
                ? error.message.match(/SOURCE_SYNC\.[A-Z_]+/)?.[0]
                : undefined;
        this.message.set(
            fallback === 'SOURCE_SYNC.CONNECTION_FAILED' &&
                (!key ||
                    key === 'SOURCE_SYNC.OFFLINE' ||
                    key === 'SOURCE_SYNC.REQUEST_FAILED')
                ? fallback
                : (key ?? fallback)
        );
    }
}

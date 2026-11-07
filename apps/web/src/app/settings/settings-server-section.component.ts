import { SettingsHostedServerComponent } from './settings-hosted-server.component';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { SettingsHistorySectionComponent } from './settings-history-section.component';
import { SettingsFavoritesSectionComponent } from './settings-favorites-section.component';
import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
    viewChild,
    computed,
} from '@angular/core';
import {
    FormControl,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { dialogSize } from '@iptvnator/ui/components/dialog-size';
import {
    SERVER_GUIDES,
    SettingsServerAboutDialogComponent,
} from './settings-server-about-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';
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
        SettingsHostedServerComponent,
        SettingsFavoritesSectionComponent,
        SettingsHistorySectionComponent,
        SettingsSyncStatusComponent,
        MatIconModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        TranslateModule,
    ],
    templateUrl: './settings-server-section.component.html',
    styleUrl: './settings-server-section.component.scss',
})
export class SettingsServerSectionComponent {
    private readonly dialog = inject(MatDialog);
    readonly guides = SERVER_GUIDES;
    readonly sync = inject(SourceSyncService);
    readonly supportsHosting = inject(RuntimeCapabilitiesService)
        .supportsHostedServer;

    readonly hostedServer = viewChild(SettingsHostedServerComponent);
    readonly localServerUrl = computed(
        () => this.hostedServer()?.status().localUrl
    );

    showAbout(): void {
        this.dialog.open(SettingsServerAboutDialogComponent, dialogSize('md'));
    }

    async connectHosted(url: string): Promise<void> {
        if (this.busy()) return;
        try {
            const code = await window.electron.hostedServerAccessCode!();
            this.urlControl.setValue(url);
            this.token = code;
            await this.connect();
        } catch {
            this.message.set('HOSTED_SERVER.CODE_FAILED');
        } finally {
            this.token = '';
        }
    }
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

    isCurrentServer(): boolean {
        const input = this.urlControl.value.trim().replace(/\/+$/, '');
        if (!this.sync.connection) return false;
        try {
            return (
                input === this.sync.connection.apiUrl ||
                normalizeSourceServerUrl(input) === this.sync.connection.apiUrl
            );
        } catch {
            return false;
        }
    }

    async refresh(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.message.set('');
        try {
            await this.sync.refresh();
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    async connect(): Promise<void> {
        if (this.busy()) return;
        this.message.set('');
        this.urlControl.markAsTouched();
        if (this.urlControl.invalid) return;
        if (this.isCurrentServer() && !this.token) {
            await this.refresh();
            return;
        }
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
                    !this.isCurrentServer()
                );
                this.token = '';
                if (this.isCurrentServer()) await this.sync.refresh();
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
                if (
                    this.isCurrentServer() &&
                    instance.instanceId !== this.sync.connection?.instanceId
                )
                    throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
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
                if (this.isCurrentServer()) await this.sync.refresh();
                else location.reload();
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

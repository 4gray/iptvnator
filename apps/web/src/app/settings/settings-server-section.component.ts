import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';
import {
    normalizeSourceServerUrl,
    sourceFromPlaylist,
    type Playlist,
} from '@iptvnator/shared/interfaces';
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
    imports: [
        DatePipe,
        FormsModule,
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
                color: var(--app-eyebrow-color);
                overflow-wrap: anywhere;
            }
            button,
            input,
            mat-checkbox {
                app-region: no-drag;
            }
        `,
    ],
})
export class SettingsServerSectionComponent {
    readonly sync = inject(SourceSyncService);
    readonly busy = signal(false);
    readonly message = signal('');
    readonly preview = signal<Playlist[] | null>(null);
    url = this.sync.connection?.apiUrl ?? '';
    token = '';

    async connect(): Promise<void> {
        this.busy.set(true);
        this.message.set('');
        try {
            const input = this.url.trim().replace(/\/+$/, '');
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
            } else {
                const response = await fetch(`${apiUrl}/v1/instance`, {
                    redirect: 'error',
                    signal: AbortSignal.timeout(10000),
                });
                const instance: unknown = await response.json();
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
                        check.status === 401
                            ? 'SOURCE_SYNC.LOCKED'
                            : 'SOURCE_SYNC.REQUEST_FAILED'
                    );
                saveBrowserSourceConnection(
                    { apiUrl, instanceId: instance.instanceId! },
                    this.token
                );
                location.reload();
            }
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
            this.token = '';
        }
    }

    async disconnect(): Promise<void> {
        if (window.electron?.sourceSyncDisconnect)
            await window.electron.sourceSyncDisconnect();
        else {
            disconnectBrowserSourceConnection();
            location.reload();
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
                    id: crypto.randomUUID(),
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

    private showError(error: unknown): void {
        const key =
            error instanceof Error
                ? error.message.match(/SOURCE_SYNC\.[A-Z_]+/)?.[0]
                : undefined;
        this.message.set(key ?? 'SOURCE_SYNC.REQUEST_FAILED');
    }
}

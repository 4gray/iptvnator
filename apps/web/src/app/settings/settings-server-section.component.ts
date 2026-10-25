import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    output,
    signal,
    ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import {
    SERVER_STORAGE_CONFIG,
    ServerMigrationService,
    ServerStorageSession,
    type ServerMigrationResult,
} from '@iptvnator/services/server-storage';
import type { ServerStorageStatusResponse } from '@iptvnator/shared/interfaces';

/**
 * Settings → Server: shown only when the PWA runs against self-hosted
 * server storage. Rendered without `@defer` so settings search can reveal
 * its rows on the first visit; the code rides in the lazy settings chunk.
 */
@Component({
    selector: 'app-settings-server-section',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslatePipe,
    ],
    templateUrl: './settings-server-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsServerSectionComponent {
    private readonly status = inject(ServerStorageStatusService);
    private readonly session = inject(ServerStorageSession);
    private readonly migration = inject(ServerMigrationService);

    readonly exportData = output<void>();

    readonly state = this.status.state;
    readonly usesToken = computed(
        () => this.status.instance()?.auth === 'token'
    );
    /** The backend's origin; the page's own in Docker (`/api`). */
    readonly address = backendOrigin(inject(SERVER_STORAGE_CONFIG).baseUrl);
    readonly details = signal<ServerStorageStatusResponse | null>(null);
    readonly browserPlaylistCount = signal(0);
    readonly importing = signal(false);
    readonly importFailed = signal(false);
    readonly importResult = signal<ServerMigrationResult | null>(null);
    readonly sizeLabel = computed(() =>
        formatMegabytes(this.details()?.databaseBytes ?? 0)
    );
    readonly showBrowserImport = computed(
        () => this.browserPlaylistCount() > 0 || this.importResult() !== null
    );
    readonly movedSomething = computed(() => {
        const result = this.importResult();
        return !!result && result.imported + result.merged > 0;
    });

    constructor() {
        void this.load();
    }

    async load(): Promise<void> {
        try {
            this.details.set(await this.session.fetchStatus());
        } catch {
            this.details.set(null);
        }
        try {
            this.browserPlaylistCount.set(
                this.migration.browserDataMoved()
                    ? 0
                    : (await this.migration.browserPlaylists()).length
            );
        } catch {
            this.browserPlaylistCount.set(0);
        }
    }

    async importBrowserPlaylists(): Promise<void> {
        this.importing.set(true);
        this.importFailed.set(false);
        try {
            this.importResult.set(await this.migration.moveBrowserData());
            await this.load();
        } catch {
            this.importFailed.set(true);
        } finally {
            this.importing.set(false);
        }
    }

    signOut(): void {
        this.session.signOut();
    }

    reload(): void {
        window.location.reload();
    }
}

function backendOrigin(baseUrl: string): string {
    try {
        return new URL(baseUrl, globalThis.location?.href).origin;
    } catch {
        return baseUrl;
    }
}

function formatMegabytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

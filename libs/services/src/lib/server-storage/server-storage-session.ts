import { effect, inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import type {
    ServerInstanceInfo,
    ServerStorageStatusResponse,
} from '@iptvnator/shared/interfaces';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import {
    clearServerAccessToken,
    readServerAccessToken,
} from '../server-access-token';
import {
    SERVER_SIGN_IN_PATH,
    ServerStorageStatusService,
} from '../server-storage-status.service';
import {
    createBrowserSessionStorage,
    createBrowserUserDataStorage,
} from '../user-data-storage';
import { ServerApiClient, type ServerApiError } from './server-api-client';
import { ServerPlaylistDocumentStore } from './server-playlist-document-store';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerUserDataStorage } from './server-user-data-storage';

const RETRY_INTERVAL_MS = 30_000;
const STARTUP_HYDRATE_WAIT_MS = 3_000;

/** Server mode for this page: created only when the probe found server storage. */
@Injectable({ providedIn: 'root' })
export class ServerStorageSession {
    private readonly config = inject(SERVER_STORAGE_CONFIG);
    private readonly status = inject(ServerStorageStatusService);
    private readonly backend = inject(PlaylistStorageBackend);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly router = inject(Router);
    private reloading = false;

    readonly api = new ServerApiClient({
        baseUrl: this.config.baseUrl,
        status: this.status,
        onWriteFailure: (error) => this.announceWriteFailure(error),
        // A remembered instance may answer as another database: writes
        // wait for the reload that checks which one it is.
        holdWrites: this.config.startedOffline,
    });
    readonly documentStore = new ServerPlaylistDocumentStore(
        this.api,
        (playlistId, remove) => this.userData.deleting(playlistId, remove)
    );
    readonly userData = new ServerUserDataStorage(
        this.api,
        // Lazy: a browser that denies storage must not stop the app here.
        createBrowserUserDataStorage(),
        () => this.announceWriteFailure(),
        this.config.instance.instanceId ?? undefined,
        createBrowserSessionStorage()
    );

    constructor() {
        effect(() => {
            if (
                this.status.state() === 'unauthorized' &&
                !this.router.url.startsWith(SERVER_SIGN_IN_PATH)
            ) {
                void this.router.navigateByUrl(SERVER_SIGN_IN_PATH);
            }
        });
    }

    /** App initializer: must run before the first playlist read. */
    async start(): Promise<void> {
        this.backend.useServerStore(this.documentStore);
        this.status.activate(this.config.instance, () => void this.refresh());
        if (this.config.instance.auth === 'token' && !readServerAccessToken()) {
            this.status.reportUnauthorized();
            return;
        }
        await Promise.race([
            this.refresh(),
            new Promise((resolve) =>
                setTimeout(resolve, STARTUP_HYDRATE_WAIT_MS)
            ),
        ]);
        this.listen();
    }

    /** Re-reads synced user data; also the offline retry. */
    async refresh(): Promise<void> {
        if (this.config.startedOffline) {
            await this.reloadOnceReachable();
            return;
        }
        try {
            await this.userData.hydrate();
        } catch {
            // The API client already reported offline or unauthorized.
        }
    }

    /**
     * Nothing was read at start: once the server answers, boot again, so
     * its instance is checked before anything is sent.
     */
    private async reloadOnceReachable(): Promise<void> {
        try {
            await this.api.getJson<ServerInstanceInfo>('/instance');
        } catch {
            return;
        }
        if (!this.reloading) {
            this.reloading = true;
            this.reloadPage();
        }
    }

    fetchStatus(): Promise<ServerStorageStatusResponse> {
        return this.api.getJson<ServerStorageStatusResponse>(
            '/instance/status'
        );
    }

    signOut(): void {
        clearServerAccessToken();
        this.status.reportUnauthorized();
    }

    private listen(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.userData.flushWithKeepalive();
            } else {
                void this.refresh();
            }
        });
        window.addEventListener('pagehide', () =>
            this.userData.flushWithKeepalive()
        );
        setInterval(() => {
            this.userData.touch();
            if (this.status.state() === 'offline') {
                void this.refresh();
            }
        }, RETRY_INTERVAL_MS);
    }

    /** Separate so tests can observe it. */
    protected reloadPage(): void {
        window.location.reload();
    }

    private announceWriteFailure(error?: ServerApiError): void {
        const key =
            error?.status === 413
                ? 'SERVER_STORAGE.TOO_LARGE'
                : 'SERVER_STORAGE.WRITE_FAILED';
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration: 5000,
        });
    }
}

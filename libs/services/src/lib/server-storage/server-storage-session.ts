import { effect, inject, Injectable, untracked } from '@angular/core';
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
import { markSlowStart } from '../server-slow-start';
import { ServerApiClient, type ServerApiError } from './server-api-client';
import { ServerPlaylistDocumentStore } from './server-playlist-document-store';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerUserDataStorage } from './server-user-data-storage';

const RETRY_INTERVAL_MS = 30_000;
const STARTUP_HYDRATE_WAIT_MS = 3_000;
const NOTICE_REPEAT_MS = 5 * 60_000;

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
    private lastQuickCheck = 0;
    private lastNotice = { key: '', at: 0 };

    readonly api = new ServerApiClient({
        baseUrl: this.config.baseUrl,
        status: this.status,
        onWriteFailure: (error) => this.announceWriteFailure(error),
        // A remembered instance, or one that went offline, may answer as
        // another database: writes and the token wait until it is checked.
        holdWrites: () => !this.status.isVerified(),
        accessToken: () => this.status.accessToken(),
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
        effect(() => {
            if (
                this.status.state() === 'offline' &&
                !this.config.startedOffline
            ) {
                untracked(() => this.checkSoon());
            }
        });
    }

    /** App initializer: must run before the first playlist read. */
    async start(): Promise<void> {
        this.backend.useServerStore(this.documentStore);
        this.status.activate(
            this.config.instance,
            () => void this.refresh(),
            !this.config.startedOffline
        );
        // Also while sign-in is pending: this page may already hold another
        // page load's writes, so it must mark itself closed on page hide.
        this.listen();
        if (
            this.config.instance.auth === 'token' &&
            !readServerAccessToken(this.config.instance.instanceId)
        ) {
            this.status.reportUnauthorized();
            return;
        }
        await Promise.race([
            this.refresh(),
            new Promise((resolve) =>
                setTimeout(resolve, STARTUP_HYDRATE_WAIT_MS)
            ),
        ]);
    }

    /**
     * Gone offline, the token and writes wait for the instance check:
     * after a blip it passes at once, not at the next retry. Only the
     * check, and once per retry interval: a read or a check that keeps
     * failing (a body cut off after its headers) waits for the retry.
     */
    private checkSoon(): void {
        const now = Date.now();
        if (now - this.lastQuickCheck < RETRY_INTERVAL_MS) {
            return;
        }
        this.lastQuickCheck = now;
        void this.ensureVerified().catch(() => undefined);
    }

    /** Re-reads synced user data; also the offline retry. */
    async refresh(): Promise<void> {
        if (this.config.startedOffline) {
            await this.reloadOnceReachable();
            return;
        }
        try {
            // Back from offline: the instance first, as the read flushes.
            await this.ensureVerified();
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
            // It answers, maybe slower than the start probe waits.
            markSlowStart();
            this.reloadPage();
        }
    }

    /**
     * Before a token or a write goes out from a page started from memory,
     * or one that went offline: the instance answering at the address must
     * be this page's. Another one reloads the page, which starts against it.
     */
    async ensureVerified(): Promise<void> {
        if (this.status.isVerified()) {
            return;
        }
        const { instanceId } =
            await this.api.getJson<ServerInstanceInfo>('/instance');
        if (instanceId !== this.config.instance.instanceId) {
            this.reloadPage();
            throw new Error('Another server answers at this address.');
        }
        this.status.markVerified();
    }

    fetchStatus(): Promise<ServerStorageStatusResponse> {
        return this.api.getJson<ServerStorageStatusResponse>(
            '/instance/status'
        );
    }

    signOut(): void {
        clearServerAccessToken();
        this.status.reportUnauthorized();
        // Also when signed out already: a guard (unsaved Settings) may have
        // kept the page here the first time.
        void this.router.navigateByUrl(SERVER_SIGN_IN_PATH);
    }

    private listen(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.userData.flushWithKeepalive();
            } else if (!this.userData.resumed()) {
                // Suspended long enough for another tab to take its writes.
                this.reloadPage();
            } else {
                void this.refresh();
            }
        });
        window.addEventListener('pageshow', (event) => {
            // Back from the back-forward cache: another tab may have taken
            // its writes over while it was frozen; then this page reloads.
            if (event.persisted && !this.userData.resumed()) {
                this.reloadPage();
            }
        });
        window.addEventListener('pagehide', (event) => {
            this.userData.flushWithKeepalive();
            // Not into the back-forward cache: the page is gone for good.
            if (!event.persisted) {
                this.userData.close();
            }
        });
        setInterval(() => {
            // A suspended tab's timers can run before it is shown again.
            if (!this.userData.resumed()) {
                this.reloadPage();
                return;
            }
            this.userData.touch();
            // Also online: a write the server refused (a 5xx) or a first
            // read that failed is not retried by anything else.
            // Online but unverified too: a late answer to a request sent
            // before the outage may have set it online again.
            const state = this.status.state();
            if (
                state === 'offline' ||
                (state === 'online' &&
                    (this.userData.needsSync() || !this.status.isVerified()))
            ) {
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
        // Retries must not repeat the same notice every 30 s.
        const now = Date.now();
        if (
            key === this.lastNotice.key &&
            now - this.lastNotice.at < NOTICE_REPEAT_MS
        ) {
            return;
        }
        this.lastNotice = { key, at: now };
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration: 5000,
        });
    }
}

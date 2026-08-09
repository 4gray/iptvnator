import { inject, Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs';
import { SettingsService } from '../services/settings.service';
import { AppUpdateReleaseNotesDialogComponent } from './app-update-release-notes-dialog.component';
import { SettingsUnloadGuardService } from './settings-unload-guard.service';

const APP_UPDATE_STATUS_LOAD_ATTEMPTS = 60;
const APP_UPDATE_STATUS_LOAD_RETRY_DELAY_MS = 250;

/**
 * Owns everything the About section needs to talk about versions: the
 * electron-updater status stream and the "is my build outdated" message.
 */
@Injectable()
export class SettingsAppUpdateFacade {
    private readonly dataService = inject(DataService);
    private readonly matDialog = inject(MatDialog);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsService = inject(SettingsService);
    private readonly translate = inject(TranslateService);
    private readonly unloadGuard = inject(SettingsUnloadGuardService);

    /** Latest updater status, polled once and then pushed by the backend */
    readonly status = signal<ElectronBridgeAppUpdateStatus | null>(null);

    /** Current version of the app */
    readonly version = signal('');

    /** Update message to show */
    readonly updateMessage = signal('');

    private unsubscribeStatus: (() => void) | null = null;
    /** True after an install reply promised a quit that has not happened. */
    private installQuitPending = false;

    /** Subscribes to status pushes and kicks off the initial status load */
    init(): void {
        this.bindStatusEvents();
        void this.loadStatus();
    }

    dispose(): void {
        this.unsubscribeStatus?.();
        this.unsubscribeStatus = null;
    }

    async checkForAppUpdate(): Promise<void> {
        if (!this.runtime.isElectron || !window.electron?.checkForAppUpdate) {
            return;
        }

        this.status.set(await window.electron.checkForAppUpdate());
    }

    async downloadAppUpdate(): Promise<void> {
        if (!this.runtime.isElectron || !window.electron?.downloadAppUpdate) {
            return;
        }

        this.status.set(await window.electron.downloadAppUpdate());
    }

    async installAppUpdate(): Promise<void> {
        if (!this.runtime.isElectron || !window.electron?.installAppUpdate) {
            return;
        }

        // Installing quits the app; the unsaved-settings unload guard must
        // not fight a quit the user just asked for — its `beforeunload`
        // would cancel the updater's window close at the DOM layer and
        // strand the install. A 'downloaded' reply means quitAndInstall ran
        // and the app is going down; anything else — including a rejected
        // IPC — means no quit happened, so the protection comes back.
        this.unloadGuard.suspendForAppQuit();

        try {
            const status = await window.electron.installAppUpdate();
            this.status.set(status);

            if (
                status?.status ===
                ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
            ) {
                // quitAndInstall ran, but electron-updater reports its
                // failures as a later 'error' status push rather than here —
                // the status stream (bindStatusEvents) resumes the guard if
                // that happens instead of a quit.
                this.installQuitPending = true;
            } else {
                this.unloadGuard.resumeAfterAbortedAppQuit();
            }
        } catch (error) {
            this.unloadGuard.resumeAfterAbortedAppQuit();
            throw error;
        }
    }

    openManualAppUpdate(): void {
        const manualDownloadUrl = this.status()?.manualDownloadUrl;

        if (!manualDownloadUrl) {
            return;
        }

        window.open(manualDownloadUrl, '_blank', 'noreferrer');
    }

    openReleaseNotes(): void {
        const status = this.status();
        const isUpdateRelease =
            status?.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available ||
            status?.status ===
                ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading ||
            status?.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded;
        const initialReleaseNotesVersion = isUpdateRelease
            ? (status?.latestVersion ??
              status?.release?.version ??
              status?.currentVersion)
            : status?.currentVersion;

        this.matDialog.open(AppUpdateReleaseNotesDialogComponent, {
            autoFocus: false,
            data: {
                ...(!isUpdateRelease ? { fallbackToLatest: true } : {}),
                initialVersion: initialReleaseNotesVersion,
            },
            maxWidth: 'calc(100vw - 32px)',
            restoreFocus: true,
            width: '720px',
        });
    }

    /**
     * Checks whether the latest version of the application
     * is used and updates the version message in the
     * settings UI
     */
    checkAppVersion(): void {
        this.settingsService
            .getAppVersion()
            .pipe(take(1))
            .subscribe((version) => this.showVersionInformation(version));
    }

    /**
     * Updates the message in settings UI about the used
     * version of the app
     * @param currentVersion current version of the application
     */
    showVersionInformation(currentVersion: string): void {
        const isOutdated = this.isCurrentVersionOutdated(currentVersion);

        if (isOutdated) {
            this.updateMessage.set(
                `${
                    this.translate.instant(
                        'SETTINGS.NEW_VERSION_AVAILABLE'
                    ) as string
                }: ${currentVersion}`
            );
        } else {
            this.updateMessage.set(
                this.translate.instant('SETTINGS.LATEST_VERSION')
            );
        }
    }

    /**
     * Compares actual with latest version of the
     * application
     * @param latestVersion latest version
     * @returns returns true if an update is available
     */
    isCurrentVersionOutdated(latestVersion: string): boolean {
        this.version.set(this.dataService.getAppVersion());
        return this.settingsService.isVersionOutdated(
            this.version(),
            latestVersion
        );
    }

    private bindStatusEvents(): void {
        if (
            !this.runtime.isElectron ||
            !window.electron?.onAppUpdateStatusChange
        ) {
            return;
        }

        this.unsubscribeStatus = window.electron.onAppUpdateStatusChange(
            (status) => {
                this.status.set(status);

                // Any post-install status other than the quitting install's
                // own proves the app is still running — the promised quit is
                // not coming, so the unload protection returns.
                if (
                    this.installQuitPending &&
                    status.status !==
                        ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
                ) {
                    this.installQuitPending = false;
                    this.unloadGuard.resumeAfterAbortedAppQuit();
                }
            }
        );
    }

    /**
     * The updater IPC handlers can still be registering while the settings
     * page mounts, so the first load retries until the bridge answers.
     */
    private async loadStatus(): Promise<void> {
        if (!this.runtime.isElectron) {
            return;
        }

        let lastError: unknown;

        for (
            let attempt = 1;
            attempt <= APP_UPDATE_STATUS_LOAD_ATTEMPTS;
            attempt += 1
        ) {
            const electron = window.electron;

            if (electron?.getAppUpdateStatus) {
                try {
                    this.status.set(await electron.getAppUpdateStatus());
                    return;
                } catch (error) {
                    lastError = error;
                }
            }

            if (attempt === APP_UPDATE_STATUS_LOAD_ATTEMPTS) {
                console.warn(
                    'Failed to load app update status:',
                    lastError ??
                        new Error('Desktop app update bridge is unavailable')
                );
                return;
            }

            await this.waitForRetry();
        }
    }

    private async waitForRetry(): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, APP_UPDATE_STATUS_LOAD_RETRY_DELAY_MS);
        });
    }
}

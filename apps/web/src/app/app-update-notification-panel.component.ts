import {
    Component,
    computed,
    OnDestroy,
    OnInit,
    signal,
    inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateReleaseNotesDialogComponent } from './settings/app-update-release-notes-dialog.component';

@Component({
    selector: 'app-update-notification-panel',
    imports: [MatButtonModule, MatIconModule, TranslatePipe],
    template: `
        @if (isVisible(); as visible) {
            <section
                class="app-update-notification"
                data-test-id="app-update-notification"
            >
                <header class="app-update-notification__header">
                    <span>
                        <mat-icon>system_update</mat-icon>
                        {{ 'SETTINGS.APP_UPDATE_TITLE' | translate }}
                    </span>
                    <button
                        mat-icon-button
                        type="button"
                        (click)="dismiss()"
                        [attr.aria-label]="'CLOSE' | translate"
                    >
                        <mat-icon>close</mat-icon>
                    </button>
                </header>

                <div class="app-update-notification__body">
                    <strong>
                        {{
                            labelKey()
                                | translate
                                    : {
                                          version:
                                              status()?.latestVersion ||
                                              status()?.currentVersion,
                                      }
                        }}
                    </strong>
                    @if (status()?.progress; as progress) {
                        <progress
                            [value]="progress.percent"
                            max="100"
                        ></progress>
                    }
                </div>

                <div class="app-update-notification__actions">
                    <button
                        mat-stroked-button
                        type="button"
                        (click)="openReleaseNotes()"
                        data-test-id="app-update-notification-release-notes"
                    >
                        <mat-icon>article</mat-icon>
                        {{ 'SETTINGS.APP_UPDATE_RELEASE_NOTES' | translate }}
                    </button>

                    @if (status()?.status === appUpdateStatuses.Downloaded) {
                        <button
                            mat-flat-button
                            type="button"
                            (click)="installUpdate()"
                            data-test-id="app-update-notification-install"
                        >
                            <mat-icon>restart_alt</mat-icon>
                            {{ 'SETTINGS.APP_UPDATE_INSTALL' | translate }}
                        </button>
                    } @else {
                        <button
                            mat-flat-button
                            type="button"
                            [disabled]="
                                status()?.status ===
                                appUpdateStatuses.Downloading
                            "
                            (click)="downloadUpdate()"
                            data-test-id="app-update-notification-download"
                        >
                            <mat-icon>{{ primaryActionIcon() }}</mat-icon>
                            {{ primaryActionLabelKey() | translate }}
                        </button>
                    }
                </div>
            </section>
        }
    `,
    styles: [
        `
            .app-update-notification {
                position: fixed;
                right: 20px;
                bottom: 20px;
                width: 320px;
                max-width: calc(100vw - 40px);
                z-index: 901;
                overflow: hidden;
                border: 1px solid var(--app-separator);
                border-radius: 12px;
                background: var(--app-widget-bg);
                box-shadow:
                    0 1px 2px rgba(0, 0, 0, 0.08),
                    0 8px 24px rgba(0, 0, 0, 0.18),
                    0 16px 48px rgba(0, 0, 0, 0.12);
            }

            .app-update-notification__header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 8px 8px 12px;
                border-bottom: 1px solid var(--app-separator);
            }

            .app-update-notification__header span {
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--app-heading-color);
                font-size: 0.78rem;
                font-weight: 600;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }

            .app-update-notification__header mat-icon {
                color: var(--app-selection-color);
            }

            .app-update-notification__body {
                display: grid;
                gap: 8px;
                padding: 12px;
                color: var(--app-body-color);
                font-size: 0.88rem;
            }

            .app-update-notification__body progress {
                width: 100%;
            }

            .app-update-notification__actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
                padding: 0 12px 12px;
            }

            @media (max-width: 560px) {
                .app-update-notification {
                    right: 12px;
                    bottom: 12px;
                    left: 12px;
                    width: auto;
                    max-width: none;
                }
            }
        `,
    ],
})
export class AppUpdateNotificationPanelComponent implements OnInit, OnDestroy {
    private readonly dialog = inject(MatDialog);
    private unsubscribeStatus: (() => void) | null = null;

    readonly appUpdateStatuses = ELECTRON_BRIDGE_APP_UPDATE_STATUSES;
    readonly status = signal<ElectronBridgeAppUpdateStatus | null>(null);
    readonly dismissedVersion = signal<string | null>(null);
    readonly labelKey = computed(() =>
        this.status()?.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
            ? 'SETTINGS.APP_UPDATE_DOWNLOADED'
            : 'SETTINGS.APP_UPDATE_AVAILABLE'
    );
    readonly primaryActionLabelKey = computed(() =>
        this.status()?.supportedSelfUpdate === false
            ? 'SETTINGS.APP_UPDATE_OPEN_RELEASE'
            : 'SETTINGS.APP_UPDATE_DOWNLOAD'
    );
    readonly primaryActionIcon = computed(() =>
        this.status()?.supportedSelfUpdate === false
            ? 'open_in_new'
            : 'download'
    );
    readonly isVisible = computed(() => {
        const status = this.status();

        if (!status?.latestVersion) {
            return false;
        }

        if (this.dismissedVersion() === status.latestVersion) {
            return false;
        }

        return (
            status.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available ||
            status.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading ||
            status.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
        );
    });

    ngOnInit(): void {
        if (!window.electron?.getAppUpdateStatus) {
            return;
        }

        this.unsubscribeStatus =
            window.electron.onAppUpdateStatusChange?.((status) => {
                this.status.set(status);
            }) ?? null;

        void window.electron.getAppUpdateStatus().then((status) => {
            this.status.set(status);
        });
    }

    ngOnDestroy(): void {
        this.unsubscribeStatus?.();
        this.unsubscribeStatus = null;
    }

    openReleaseNotes(): void {
        const latestVersion = this.status()?.latestVersion;

        this.dialog.open(AppUpdateReleaseNotesDialogComponent, {
            autoFocus: false,
            data: {
                initialVersion: latestVersion,
            },
            maxWidth: 'calc(100vw - 32px)',
            restoreFocus: true,
            width: '720px',
        });
    }

    async downloadUpdate(): Promise<void> {
        const status = this.status();

        if (!status) {
            return;
        }

        if (!status.supportedSelfUpdate) {
            window.open(status.manualDownloadUrl, '_blank', 'noreferrer');
            return;
        }

        if (!window.electron?.downloadAppUpdate) {
            return;
        }

        this.status.set(await window.electron.downloadAppUpdate());
    }

    async installUpdate(): Promise<void> {
        if (!window.electron?.installAppUpdate) {
            return;
        }

        this.status.set(await window.electron.installAppUpdate());
    }

    dismiss(): void {
        this.dismissedVersion.set(this.status()?.latestVersion ?? null);
    }
}

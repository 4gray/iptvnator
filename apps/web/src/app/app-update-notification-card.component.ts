import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateInstallService } from './services/app-update-install.service';

/**
 * The update notification itself: the card with its download, install and
 * release-notes actions. `AppUpdateNotificationPanelComponent` defers it
 * until an update is available, so this file and its Material imports must
 * stay out of every file that loads with the app.
 */
@Component({
    selector: 'app-update-notification-card',
    imports: [MatButtonModule, MatIconModule, TranslatePipe],
    template: `
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
                    (click)="dismissed.emit()"
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
                                          status().latestVersion ||
                                          status().currentVersion,
                                  }
                    }}
                </strong>
                @if (status().progress; as progress) {
                    <progress [value]="progress.percent" max="100"></progress>
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

                @if (status().status === appUpdateStatuses.Downloaded) {
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
                            status().status === appUpdateStatuses.Downloading
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
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
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
export class AppUpdateNotificationCardComponent {
    private readonly dialog = inject(MatDialog);
    private readonly installService = inject(AppUpdateInstallService);

    readonly status = input.required<ElectronBridgeAppUpdateStatus>();
    /** A status the card learnt from the updater (download, install). */
    readonly statusChange = output<ElectronBridgeAppUpdateStatus>();
    readonly dismissed = output<void>();

    readonly appUpdateStatuses = ELECTRON_BRIDGE_APP_UPDATE_STATUSES;
    readonly labelKey = computed(() =>
        this.status().status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
            ? 'SETTINGS.APP_UPDATE_DOWNLOADED'
            : 'SETTINGS.APP_UPDATE_AVAILABLE'
    );
    readonly primaryActionLabelKey = computed(() =>
        this.status().supportedSelfUpdate === false
            ? 'SETTINGS.APP_UPDATE_OPEN_RELEASE'
            : 'SETTINGS.APP_UPDATE_DOWNLOAD'
    );
    readonly primaryActionIcon = computed(() =>
        this.status().supportedSelfUpdate === false ? 'open_in_new' : 'download'
    );

    /**
     * Loaded on demand: the dialog renders Markdown with `marked`, which this
     * card would otherwise bring along with the first notification. A field
     * so specs can substitute it.
     */
    loadReleaseNotesDialog = () =>
        import('./settings/app-update-release-notes-dialog.component');

    async openReleaseNotes(): Promise<void> {
        const status = this.status();
        let dialogModule: Awaited<
            ReturnType<typeof this.loadReleaseNotesDialog>
        >;
        try {
            dialogModule = await this.loadReleaseNotesDialog();
        } catch (error) {
            // The same notes are on the releases page; the next click retries.
            console.error('Could not load the release notes dialog:', error);
            if (status.manualDownloadUrl) {
                window.open(status.manualDownloadUrl, '_blank', 'noreferrer');
            }
            return;
        }
        const { AppUpdateReleaseNotesDialogComponent } = dialogModule;

        this.dialog.open(AppUpdateReleaseNotesDialogComponent, {
            autoFocus: false,
            data: {
                initialVersion: status.latestVersion,
            },
            maxWidth: 'calc(100vw - 32px)',
            restoreFocus: true,
            width: '720px',
        });
    }

    async downloadUpdate(): Promise<void> {
        const status = this.status();

        if (!status.supportedSelfUpdate) {
            window.open(status.manualDownloadUrl, '_blank', 'noreferrer');
            return;
        }

        if (!window.electron?.downloadAppUpdate) {
            return;
        }

        this.statusChange.emit(await window.electron.downloadAppUpdate());
    }

    async installUpdate(): Promise<void> {
        // Never window.electron.installAppUpdate() directly: the install
        // quits the app, and AppUpdateInstallService stands the settings
        // unload guard down first — this panel is global, so the settings
        // form can be dirty right now.
        const status = await this.installService.installAppUpdate();

        if (status) {
            this.statusChange.emit(status);
        }
    }
}

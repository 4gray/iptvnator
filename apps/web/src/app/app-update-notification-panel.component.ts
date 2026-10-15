import {
    ChangeDetectionStrategy,
    Component,
    computed,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateNotificationCardComponent } from './app-update-notification-card.component';

/**
 * Follows the main process's update status and shows the notification card
 * once an update is available. The panel is mounted on every launch, so the
 * card and its Material buttons, icons and dialog load with the first
 * notification instead of with the app. Should that chunk fail to load, a
 * notice points at the settings, where the update can still be installed.
 */
@Component({
    selector: 'app-update-notification-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AppUpdateNotificationCardComponent, TranslatePipe],
    template: `
        @defer (when visibleStatus()) {
            @if (visibleStatus(); as current) {
                <app-update-notification-card
                    [status]="current"
                    (statusChange)="status.set($event)"
                    (dismissed)="dismiss()"
                />
            }
        } @error {
            @if (visibleStatus()) {
                <div class="app-update-notification-unavailable" role="alert">
                    {{ 'SETTINGS.APP_UPDATE_PANEL_UNAVAILABLE' | translate }}
                </div>
            }
        }
    `,
    styles: `
        .app-update-notification-unavailable {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 901;
            width: 320px;
            max-width: calc(100vw - 40px);
            padding: 10px 12px;
            border: 1px solid var(--app-separator);
            border-radius: 12px;
            background: var(--app-widget-bg);
            color: var(--app-body-color);
            font-size: 0.88rem;
            line-height: 1.4;
        }
        @media (max-width: 560px) {
            .app-update-notification-unavailable {
                right: 12px;
                bottom: 12px;
                left: 12px;
                width: auto;
                max-width: none;
            }
        }
    `,
})
export class AppUpdateNotificationPanelComponent implements OnInit, OnDestroy {
    private unsubscribeStatus: (() => void) | null = null;

    readonly status = signal<ElectronBridgeAppUpdateStatus | null>(null);
    readonly dismissedVersion = signal<string | null>(null);
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
    /** The status the card shows, or null while there is nothing to show. */
    readonly visibleStatus = computed(() =>
        this.isVisible() ? this.status() : null
    );

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

    dismiss(): void {
        this.dismissedVersion.set(this.status()?.latestVersion ?? null);
    }
}

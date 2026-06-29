import {
    Component,
    computed,
    input,
    output,
    ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-settings-about-section',
    imports: [MatButtonModule, MatIconModule, TranslateModule],
    templateUrl: './settings-about-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [':host { display: contents; }'],
})
export class SettingsAboutSectionComponent {
    readonly activeSection = input.required<string>();
    readonly isDesktop = input(false);
    readonly version = input<string | undefined>();
    readonly updateMessage = input<string | undefined>();
    readonly appUpdateStatus = input<ElectronBridgeAppUpdateStatus | null>(null);

    readonly checkForAppUpdate = output<void>();
    readonly downloadAppUpdate = output<void>();
    readonly installAppUpdate = output<void>();
    readonly openManualAppUpdate = output<void>();
    readonly openAppUpdateReleaseNotes = output<void>();

    readonly isAppUpdateBusy = computed(() => {
        const status = this.appUpdateStatus()?.status;

        return (
            status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking ||
            status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading
        );
    });

    readonly canDownloadAppUpdate = computed(() => {
        const status = this.appUpdateStatus();

        return (
            status?.supportedSelfUpdate === true &&
            status.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available
        );
    });

    readonly canInstallAppUpdate = computed(() => {
        const status = this.appUpdateStatus();

        return (
            status?.supportedSelfUpdate === true &&
            status.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
        );
    });

    readonly canOpenAppUpdateReleaseNotes = computed(() => {
        const status = this.appUpdateStatus();

        return Boolean(
            status?.currentVersion &&
                status.status !== ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking
        );
    });

    readonly canOpenManualAppUpdate = computed(() => {
        const status = this.appUpdateStatus();

        return Boolean(status && !status.supportedSelfUpdate);
    });

    readonly appUpdateStatusLabelKey = computed(() => {
        const status =
            this.appUpdateStatus()?.status ??
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle;

        switch (status) {
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Checking:
                return 'SETTINGS.APP_UPDATE_CHECKING';
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available:
                return 'SETTINGS.APP_UPDATE_AVAILABLE';
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable:
                return 'SETTINGS.APP_UPDATE_NOT_AVAILABLE';
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading:
                return 'SETTINGS.APP_UPDATE_DOWNLOADING';
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded:
                return 'SETTINGS.APP_UPDATE_DOWNLOADED';
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported:
                return 'SETTINGS.APP_UPDATE_IDLE';
            case ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error:
                return 'SETTINGS.APP_UPDATE_ERROR';
            default:
                return 'SETTINGS.APP_UPDATE_IDLE';
        }
    });
}

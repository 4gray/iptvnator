import {
    Component,
    computed,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { UpdateChannelOption } from './settings.models';

@Component({
    selector: 'app-settings-about-section',
    imports: [
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatSelectModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-about-section.component.html',
    encapsulation: ViewEncapsulation.None,
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        ':host { display: contents; }',
        '.version-block .build-commit { opacity: 0.65; font-size: 0.85em; }',
        '.app-update-channel { margin-top: 12px; }',
        '.app-update-channel mat-form-field { width: 100%; max-width: 320px; }',
        '.app-update-channel__note { display: block; margin-top: 4px; opacity: 0.75; font-size: 0.85em; }',
    ],
})
export class SettingsAboutSectionComponent {
    readonly isDesktop = input(false);
    readonly version = input<string | undefined>();
    readonly buildCommit = input<string | undefined>();
    readonly updateMessage = input<string | undefined>();
    readonly appUpdateStatus = input<ElectronBridgeAppUpdateStatus | null>(
        null
    );
    /**
     * The shared settings form; the channel select lives in it so a change
     * goes through the same Save and unsaved-changes flow as every other
     * setting. Absent in hosts that only render the version block.
     */
    readonly form = input<FormGroup | null>(null);
    readonly updateChannelOptions = input<UpdateChannelOption[]>([]);

    readonly buildCommitShort = computed(() => {
        const commit = this.buildCommit()?.trim();

        return commit ? commit.slice(0, 7) : undefined;
    });

    readonly checkForAppUpdate = output<void>();
    readonly downloadAppUpdate = output<void>();
    readonly installAppUpdate = output<void>();
    readonly openManualAppUpdate = output<void>();
    readonly openAppUpdateReleaseNotes = output<void>();

    readonly canSelectUpdateChannel = computed(
        () =>
            this.isDesktop() &&
            this.form() !== null &&
            this.updateChannelOptions().length > 0
    );

    /** A nightly build on the stable channel waits for the next stable release. */
    readonly isNightlyBuildOnStableChannel = computed(() => {
        const status = this.appUpdateStatus();

        return (
            status?.installedChannel === 'nightly' &&
            status.channel === 'stable'
        );
    });

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

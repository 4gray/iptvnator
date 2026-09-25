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
    AppUpdateChannel,
    APP_UPDATE_CHANNELS,
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
        '.app-update-status__channel { align-self: flex-start; padding: 2px 9px; border-radius: 999px; font-size: 0.72rem; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mat-sys-on-surface-variant); background: color-mix(in srgb, var(--mat-sys-on-surface) 9%, transparent); }',
        '.app-update-status--stale strong, .app-update-status--stale .app-update-status__channel { opacity: 0.55; }',
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
    /**
     * Emitted instead of a plain check while the channel select shows a
     * channel the updater has not been told about yet. The host saves the
     * form; the main process re-checks on its own once the saved channel
     * changes, so one click yields the verdict the user is looking at.
     */
    readonly saveAndCheckForAppUpdate = output<void>();
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

    /**
     * The channel the select currently shows. Read off the control on every
     * check rather than tracked as a signal: the section is eagerly checked
     * and the sibling nightly warning already reads the control the same way.
     */
    draftUpdateChannel(): AppUpdateChannel | null {
        const value: unknown = this.form()?.get('updateChannel')?.value;

        return APP_UPDATE_CHANNELS.includes(value as AppUpdateChannel)
            ? (value as AppUpdateChannel)
            : null;
    }

    /**
     * True while the select shows a channel other than the one the last
     * verdict describes. The verdict on screen is then about the OTHER
     * channel, and a plain "check again" would silently repeat it.
     */
    hasPendingChannelChange(): boolean {
        const draft = this.draftUpdateChannel();
        const applied = this.appUpdateStatus()?.channel;

        return draft !== null && applied !== undefined && draft !== applied;
    }

    /**
     * Whether Save would make the updater re-check. A download in flight or
     * finished belongs to the previous channel and is kept, so saving there
     * changes the channel without a new verdict and the plain check stays.
     */
    canSaveAndCheckForAppUpdate(): boolean {
        const status = this.appUpdateStatus()?.status;

        return (
            this.hasPendingChannelChange() &&
            status !== ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading &&
            status !== ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
        );
    }

    channelLabelKey(channel: AppUpdateChannel | null | undefined): string {
        return channel === 'nightly'
            ? 'SETTINGS.APP_UPDATE_CHANNEL_NIGHTLY'
            : 'SETTINGS.APP_UPDATE_CHANNEL_STABLE';
    }

    /**
     * The channel the verdict on screen belongs to. `verdictChannel` is
     * stamped by every check; a channel change saved while a download was
     * running or done keeps that download, so the two can differ until
     * the new channel is checked.
     */
    verdictChannel(): AppUpdateChannel | null {
        const status = this.appUpdateStatus();

        return status?.verdictChannel ?? status?.channel ?? null;
    }

    /** The kept download was found on another channel than the saved one. */
    hasRetainedOtherChannelVerdict(): boolean {
        const status = this.appUpdateStatus();

        return (
            status?.verdictChannel !== undefined &&
            status.verdictChannel !== status.channel
        );
    }

    readonly appliedChannelLabelKey = computed(() => {
        const channel = this.verdictChannel();

        return channel ? this.channelLabelKey(channel) : null;
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

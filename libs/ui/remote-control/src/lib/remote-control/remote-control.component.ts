import { CommonModule } from '@angular/common';
import {
    Component,
    OnDestroy,
    OnInit,
    inject,
    ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
    RemoteControlService,
    RemoteControlStatus,
} from './remote-control.service';

const PORTAL_LABEL_KEYS: Readonly<Record<string, string>> = {
    m3u: 'REMOTE_CONTROL.SOURCE_M3U',
    xtream: 'REMOTE_CONTROL.SOURCE_XTREAM',
    stalker: 'REMOTE_CONTROL.SOURCE_STALKER',
};

@Component({
    selector: 'lib-remote-control',
    imports: [CommonModule, TranslatePipe],
    templateUrl: './remote-control.component.html',
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./remote-control.component.scss'],
})
export class RemoteControlComponent implements OnInit, OnDestroy {
    private remoteControlService = inject(RemoteControlService);
    private statusRefreshTimer?: number;

    isLoading = false;
    isStatusLoading = false;
    /** Translation key of the last failed action. */
    error: string | null = null;
    status: RemoteControlStatus | null = null;
    numericInput = '';
    readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

    ngOnInit(): void {
        void this.refreshStatus();
        this.statusRefreshTimer = window.setInterval(() => {
            void this.refreshStatus(true);
        }, 2000);
    }

    ngOnDestroy(): void {
        if (this.statusRefreshTimer) {
            clearInterval(this.statusRefreshTimer);
            this.statusRefreshTimer = undefined;
        }
    }

    async changeChannelUp(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.channelUp(),
            'REMOTE_CONTROL.ERRORS.CHANNEL_UP'
        );
    }

    async changeChannelDown(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.channelDown(),
            'REMOTE_CONTROL.ERRORS.CHANNEL_DOWN'
        );
    }

    appendDigit(digit: string): void {
        if (this.numericInput.length >= 4) {
            return;
        }
        this.numericInput += digit;
    }

    backspaceDigit(): void {
        this.numericInput = this.numericInput.slice(0, -1);
    }

    clearDigits(): void {
        this.numericInput = '';
    }

    async submitChannelNumber(): Promise<void> {
        const channelNumber = Number(this.numericInput);
        if (!Number.isFinite(channelNumber) || channelNumber < 1) {
            return;
        }

        await this.executeAction(
            () =>
                this.remoteControlService.selectChannelByNumber(channelNumber),
            'REMOTE_CONTROL.ERRORS.SELECT_NUMBER'
        );
        this.clearDigits();
    }

    async volumeUp(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.volumeUp(),
            'REMOTE_CONTROL.ERRORS.VOLUME_UP'
        );
    }

    async volumeDown(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.volumeDown(),
            'REMOTE_CONTROL.ERRORS.VOLUME_DOWN'
        );
    }

    async toggleMute(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.toggleMute(),
            'REMOTE_CONTROL.ERRORS.TOGGLE_MUTE'
        );
    }

    get portalLabelKey(): string {
        return (
            PORTAL_LABEL_KEYS[this.status?.portal ?? ''] ??
            'REMOTE_CONTROL.WAITING_FOR_PLAYBACK'
        );
    }

    get hasKnownPortal(): boolean {
        return !!this.status?.portal && this.status.portal !== 'unknown';
    }

    get isReady(): boolean {
        return !!this.status?.isLiveView && !this.isLoading;
    }

    get volumePercent(): number | null {
        if (!this.status?.supportsVolume || this.status.volume == null) {
            return null;
        }

        return Math.round((this.status.volume || 0) * 100);
    }

    private async refreshStatus(silent = false): Promise<void> {
        if (!silent) {
            this.isStatusLoading = true;
        }
        try {
            this.status = await this.remoteControlService.getStatus();
        } catch (err) {
            if (!silent) {
                this.error = 'REMOTE_CONTROL.ERRORS.STATUS';
                console.error(err);
            }
        } finally {
            if (!silent) {
                this.isStatusLoading = false;
            }
        }
    }

    private async executeAction(
        action: () => Promise<void>,
        errorKey: string
    ): Promise<void> {
        this.isLoading = true;
        this.error = null;
        try {
            await action();
            await this.refreshStatus(true);
        } catch (err) {
            this.error = errorKey;
            console.error(err);
        } finally {
            this.isLoading = false;
        }
    }
}

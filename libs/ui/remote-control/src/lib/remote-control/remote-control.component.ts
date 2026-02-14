import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import {
    RemoteControlService,
    RemoteControlStatus,
} from './remote-control.service';

@Component({
    selector: 'lib-remote-control',
    imports: [CommonModule],
    templateUrl: './remote-control.component.html',
    styleUrls: ['./remote-control.component.scss'],
})
export class RemoteControlComponent implements OnInit, OnDestroy {
    private remoteControlService = inject(RemoteControlService);
    private statusRefreshTimer?: number;

    isLoading = false;
    isStatusLoading = false;
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
            'Failed to change channel up'
        );
    }

    async changeChannelDown(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.channelDown(),
            'Failed to change channel down'
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
            'Failed to switch by channel number'
        );
        this.clearDigits();
    }

    async volumeUp(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.volumeUp(),
            'Failed to increase volume'
        );
    }

    async volumeDown(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.volumeDown(),
            'Failed to decrease volume'
        );
    }

    async toggleMute(): Promise<void> {
        await this.executeAction(
            () => this.remoteControlService.toggleMute(),
            'Failed to toggle mute'
        );
    }

    get portalLabel(): string {
        const portal = this.status?.portal ?? 'unknown';
        if (portal === 'm3u') return 'M3U Live';
        if (portal === 'xtream') return 'Xtream Live';
        if (portal === 'stalker') return 'Stalker ITV';
        return 'Waiting For Playback';
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
                this.error = 'Failed to fetch remote status';
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
        errorMessage: string
    ): Promise<void> {
        this.isLoading = true;
        this.error = null;
        try {
            await action();
            await this.refreshStatus(true);
        } catch (err) {
            this.error = errorMessage;
            console.error(err);
        } finally {
            this.isLoading = false;
        }
    }
}

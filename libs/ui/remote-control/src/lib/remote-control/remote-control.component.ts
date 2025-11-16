import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RemoteControlService } from './remote-control.service';

@Component({
    selector: 'lib-remote-control',
    imports: [CommonModule],
    templateUrl: './remote-control.component.html',
    styleUrls: ['./remote-control.component.scss'],
})
export class RemoteControlComponent {
    private remoteControlService = inject(RemoteControlService);

    isLoading = false;
    error: string | null = null;

    async changeChannelUp(): Promise<void> {
        this.isLoading = true;
        this.error = null;
        try {
            await this.remoteControlService.channelUp();
        } catch (err) {
            this.error = 'Failed to change channel up';
            console.error(err);
        } finally {
            this.isLoading = false;
        }
    }

    async changeChannelDown(): Promise<void> {
        this.isLoading = true;
        this.error = null;
        try {
            await this.remoteControlService.channelDown();
        } catch (err) {
            this.error = 'Failed to change channel down';
            console.error(err);
        } finally {
            this.isLoading = false;
        }
    }
}

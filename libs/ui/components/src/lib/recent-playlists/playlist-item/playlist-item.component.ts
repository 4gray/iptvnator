import { DatePipe } from '@angular/common';
import { Component, Input, OnInit, inject, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PortalStatus, PortalStatusService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';

@Component({
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
    imports: [
        DatePipe,
        MatIconButton,
        MatIcon,
        MatListModule,
        MatTooltip,
        TranslatePipe,
    ],
})
export class PlaylistItemComponent implements OnInit {
    @Input() item!: PlaylistMeta;
    readonly showActions = input(true);

    readonly editPlaylistClicked = output<PlaylistMeta>();
    readonly playlistClicked = output<string>();
    readonly refreshClicked = output<PlaylistMeta>();
    readonly removeClicked = output<string>();

    portalStatus: PortalStatus = 'unavailable';
    private readonly portalStatusService = inject(PortalStatusService);

    async ngOnInit() {
        await this.checkPortalStatus();
    }

    private async checkPortalStatus() {
        try {
            if (
                this.item.serverUrl &&
                this.item.username &&
                this.item.password
            ) {
                this.portalStatus =
                    await this.portalStatusService.checkPortalStatus(
                        this.item.serverUrl,
                        this.item.username,
                        this.item.password
                    );
            }
        } catch (error) {
            console.error('Error checking portal status:', error);
            this.portalStatus = 'unavailable';
        }
    }

    getStatusClass(): string {
        return this.portalStatusService.getStatusClass(this.portalStatus);
    }

    getStatusIcon(): string {
        return this.portalStatusService.getStatusIcon(this.portalStatus);
    }
}

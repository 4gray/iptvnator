import { DatePipe, NgIf } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    OnInit,
    Output,
    inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    PortalStatus,
    PortalStatusService,
} from '../../../services/portal-status.service';
import { PlaylistMeta } from '../../../shared/playlist-meta.type';

@Component({
    standalone: true,
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
    imports: [
        DatePipe,
        MatButtonModule,
        MatDivider,
        MatIconModule,
        MatListModule,
        MatTooltipModule,
        NgIf,
        TranslateModule,
    ],
})
export class PlaylistItemComponent implements OnInit {
    @Input() item: PlaylistMeta;
    @Input() showActions = true;

    @Output() editPlaylistClicked = new EventEmitter<PlaylistMeta>();
    @Output() playlistClicked = new EventEmitter<string>();
    @Output() refreshClicked = new EventEmitter<PlaylistMeta>();
    @Output() removeClicked = new EventEmitter<string>();

    portalStatus: PortalStatus = 'unavailable';
    private readonly portalStatusService = inject(PortalStatusService);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async ngOnInit() {
        if (this.item?.serverUrl) {
            await this.checkPortalStatus();
        }
    }

    private async checkPortalStatus() {
        try {
            this.portalStatus =
                await this.portalStatusService.checkPortalStatus(
                    this.item.serverUrl,
                    this.item.username,
                    this.item.password
                );
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

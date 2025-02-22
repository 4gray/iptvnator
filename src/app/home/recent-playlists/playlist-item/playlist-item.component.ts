import { DragDropModule } from '@angular/cdk/drag-drop';
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
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '../../../services/data.service';
import { PlaylistMeta } from '../../../shared/playlist-meta.type';

@Component({
    standalone: true,
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
    imports: [
        DatePipe,
        DragDropModule,
        MatButtonModule,
        MatDividerModule,
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

    portalStatus: 'active' | 'inactive' | 'expired' | 'unavailable' =
        'unavailable';
    private readonly dataService = inject(DataService);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async ngOnInit() {
        if (this.item?.serverUrl) {
            await this.checkPortalStatus();
        }
    }

    private async checkPortalStatus() {
        try {
            const response = await this.dataService.fetchData(
                `${this.item.serverUrl}/player_api.php`,
                {
                    username: this.item.username,
                    password: this.item.password,
                    action: 'get_account_info',
                }
            );

            if (!response?.user_info?.status) {
                this.portalStatus = 'unavailable';
                return;
            }

            if (response.user_info.status === 'Active') {
                const expDate = new Date(
                    parseInt(response.user_info.exp_date) * 1000
                );
                this.portalStatus = expDate < new Date() ? 'expired' : 'active';
            } else {
                this.portalStatus = 'inactive';
            }
        } catch (error) {
            console.error('Error checking portal status:', error);
            this.portalStatus = 'unavailable';
        }
    }

    getStatusClass(): string {
        return `status-${this.portalStatus}`;
    }
}

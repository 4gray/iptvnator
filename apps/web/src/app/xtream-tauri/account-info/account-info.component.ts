import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectActivePlaylist } from 'm3u-state';
import { DataService } from 'services';
import { XtreamAccountInfo } from './account-info.interface';

@Component({
    selector: 'app-account-info',
    imports: [MatButton, MatDialogModule, MatListModule, TranslatePipe],
    templateUrl: './account-info.component.html',
    styleUrl: './account-info.component.scss',
})
export class AccountInfoComponent {
    readonly data = inject<{
        vodStreamsCount: number;
        liveStreamsCount: number;
        seriesCount: number;
    }>(MAT_DIALOG_DATA);
    private readonly dataService = inject(DataService);
    private readonly store = inject(Store);

    accountInfo: XtreamAccountInfo;
    formattedExpDate: string;
    formattedCreatedDate: string;
    vodStreamsCount: number;
    liveStreamsCount: number;
    seriesCount: number;

    readonly currentPlaylist = this.store.selectSignal(selectActivePlaylist);

    constructor() {
        this.setAccountInfo();
        this.vodStreamsCount = this.data.vodStreamsCount;
        this.liveStreamsCount = this.data.liveStreamsCount;
        this.seriesCount = this.data.seriesCount;
    }

    async setAccountInfo() {
        const playlist = this.currentPlaylist();
        if (!playlist) return;

        try {
            this.accountInfo = await this.dataService.fetchData(
                `${playlist.serverUrl}/player_api.php`,
                {
                    username: playlist.username,
                    password: playlist.password,
                    action: 'get_account_info',
                }
            );

            if (this.accountInfo) {
                this.formattedExpDate = new Date(
                    parseInt(this.accountInfo.user_info.exp_date) * 1000
                ).toLocaleDateString();
                this.formattedCreatedDate = new Date(
                    parseInt(this.accountInfo.user_info.created_at) * 1000
                ).toLocaleDateString();
            }
        } catch (error) {
            console.error('Failed to fetch account info:', error);
        }
    }

    get isActive(): boolean {
        return this.accountInfo?.user_info?.status === 'Active';
    }

    get isTrial(): boolean {
        return this.accountInfo?.user_info?.is_trial === '1';
    }
}

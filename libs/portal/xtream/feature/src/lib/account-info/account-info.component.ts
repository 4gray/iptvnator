import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';
import {
    XtreamAccountInfo,
    XtreamApiService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { createLogger } from '@iptvnator/portal/shared/util';

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
    private readonly xtreamApiService = inject(XtreamApiService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly logger = createLogger('XtreamAccountInfo');

    accountInfo: XtreamAccountInfo;
    formattedExpDate: string;
    formattedCreatedDate: string;
    vodStreamsCount: number;
    liveStreamsCount: number;
    seriesCount: number;

    readonly currentPlaylist = this.xtreamStore.currentPlaylist;

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
            this.accountInfo = await this.xtreamApiService.getAccountInfo({
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            });

            if (this.accountInfo) {
                this.formattedExpDate = new Date(
                    parseInt(this.accountInfo.user_info.exp_date) * 1000
                ).toLocaleDateString();
                this.formattedCreatedDate = new Date(
                    parseInt(this.accountInfo.user_info.created_at) * 1000
                ).toLocaleDateString();
            }
        } catch (error) {
            this.logger.error('Failed to fetch account info', error);
        }
    }

    get isActive(): boolean {
        return this.accountInfo?.user_info?.status === 'Active';
    }

    get isTrial(): boolean {
        return this.accountInfo?.user_info?.is_trial === '1';
    }
}

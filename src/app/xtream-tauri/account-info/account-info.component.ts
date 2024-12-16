import { CommonModule } from '@angular/common';
import { Component, Inject, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '../../services/data.service';
import { selectActivePlaylist } from '../../state/selectors';
import { XtreamAccountInfo } from './account-info.interface';

@Component({
    selector: 'app-account-info',
    standalone: true,
    imports: [
        CommonModule,
        MatButton,
        MatDialogModule,
        MatCardModule,
        MatListModule,
        TranslateModule,
    ],
    template: `
        <h2 mat-dialog-title>Account Information</h2>
        <mat-dialog-content class="mat-typography">
            <div
                *ngIf="accountInfo?.user_info?.message"
                class="welcome-message"
            >
                {{ accountInfo?.user_info?.message }}
            </div>
            <div class="info-grid">
                <div class="info-section">
                    <h3>User Information</h3>
                    <mat-list>
                        <mat-list-item>
                            Status:
                            <span [class.active]="isActive">{{
                                accountInfo?.user_info?.status
                            }}</span>
                        </mat-list-item>
                        <mat-list-item>
                            Username:
                            {{ accountInfo?.user_info?.username }}
                        </mat-list-item>
                        <mat-list-item>
                            Active Connections:
                            {{ accountInfo?.user_info?.active_cons }}/{{
                                accountInfo?.user_info?.max_connections
                            }}
                        </mat-list-item>
                        <mat-list-item>
                            Created:
                            {{ formattedCreatedDate }}
                        </mat-list-item>
                        <mat-list-item>
                            Expires: {{ formattedExpDate }}
                        </mat-list-item>
                        <mat-list-item>
                            Trial Account:
                            <span [class.trial]="isTrial">{{
                                isTrial ? 'Yes' : 'No'
                            }}</span>
                        </mat-list-item>
                        <mat-list-item>
                            Allowed Formats:
                            <span class="formats">
                                {{
                                    accountInfo?.user_info?.allowed_output_formats?.join(
                                        ', '
                                    )
                                }}
                            </span>
                        </mat-list-item>
                    </mat-list>
                </div>

                <div class="info-section">
                    <h3>Server Information</h3>
                    <mat-list>
                        <mat-list-item>
                            Live TV:
                            {{ liveStreamsCount }}
                        </mat-list-item>
                        <mat-list-item>
                            Movies:
                            {{ vodStreamsCount }}
                        </mat-list-item>
                        <mat-list-item>
                            TV Series:
                            {{ seriesCount }}
                        </mat-list-item>
                        <mat-list-item>
                            URL:
                            {{ accountInfo?.server_info?.url }}
                        </mat-list-item>
                        <mat-list-item>
                            Protocol:
                            {{ accountInfo?.server_info?.server_protocol }}
                        </mat-list-item>
                        <mat-list-item>
                            Timezone:
                            {{ accountInfo?.server_info?.timezone }}
                        </mat-list-item>
                        <mat-list-item>
                            Server Time:
                            {{ accountInfo?.server_info?.time_now }}
                        </mat-list-item>
                        <mat-list-item>
                            Ports:
                            <div class="ports">
                                <span
                                    >HTTP:
                                    {{ accountInfo?.server_info?.port }}</span
                                >
                                <span
                                    >HTTPS:
                                    {{
                                        accountInfo?.server_info?.https_port
                                    }}</span
                                >
                                <span
                                    >RTMP:
                                    {{
                                        accountInfo?.server_info?.rtmp_port
                                    }}</span
                                >
                            </div>
                        </mat-list-item>
                    </mat-list>
                </div>
            </div>
        </mat-dialog-content>
        <mat-dialog-actions>
            <button mat-button mat-dialog-close color="accent">
                {{ 'CLOSE' | translate }}
            </button>
        </mat-dialog-actions>
    `,
    styleUrl: './account-info.component.scss',
})
export class AccountInfoComponent {
    accountInfo: XtreamAccountInfo;
    formattedExpDate: string;
    formattedCreatedDate: string;

    private readonly dataService = inject(DataService);
    private readonly store = inject(Store);

    vodStreamsCount: number;
    liveStreamsCount: number;
    seriesCount: number;

    readonly currentPlaylist = this.store.selectSignal(selectActivePlaylist);

    constructor(
        @Inject(MAT_DIALOG_DATA)
        data: {
            vodStreamsCount: number;
            liveStreamsCount: number;
            seriesCount: number;
        }
    ) {
        this.setAccountInfo();
        this.vodStreamsCount = data.vodStreamsCount;
        this.liveStreamsCount = data.liveStreamsCount;
        this.seriesCount = data.seriesCount;
    }

    async setAccountInfo() {
        const playlist = this.currentPlaylist();
        console.log(playlist);
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
            console.log(this.accountInfo);
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

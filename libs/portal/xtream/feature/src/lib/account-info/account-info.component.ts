import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    XtreamAccountInfo,
    XtreamApiService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { createLogger } from '@iptvnator/portal/shared/util';

type AccountLoadState = 'loading' | 'ready' | 'error';

interface AccountStat {
    icon: string;
    labelKey: string;
    value: string;
    meter: number | null;
}

interface AccountDetailRow {
    labelKey: string;
    value: string;
    mono?: boolean;
    tone?: 'accent' | 'positive' | 'warning';
    translateValue?: boolean;
}

interface AccountPort {
    labelKey: string;
    value: string;
}

@Component({
    selector: 'app-account-info',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './account-info.component.html',
    styleUrl: './account-info.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
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

    readonly currentPlaylist = this.xtreamStore.currentPlaylist;
    readonly loadState = signal<AccountLoadState>('loading');
    readonly accountInfo = signal<XtreamAccountInfo | null>(null);
    readonly skeletonStats = [1, 2, 3, 4];
    readonly skeletonPanels = [1, 2];
    readonly vodStreamsCount = this.data.vodStreamsCount;
    readonly liveStreamsCount = this.data.liveStreamsCount;
    readonly seriesCount = this.data.seriesCount;

    readonly isActive = computed(
        () => this.accountInfo()?.user_info?.status === 'Active'
    );
    readonly isTrial = computed(
        () => this.accountInfo()?.user_info?.is_trial === '1'
    );
    readonly playlistLabel = computed(() => {
        const playlist = this.currentPlaylist();
        const info = this.accountInfo();

        return (
            playlist?.title ||
            info?.server_info?.url ||
            info?.user_info?.username ||
            '-'
        );
    });
    readonly serverHost = computed(
        () => this.accountInfo()?.server_info?.url || '-'
    );
    readonly activeConnections = computed(() =>
        this.parseNumber(this.accountInfo()?.user_info?.active_cons)
    );
    readonly maxConnections = computed(() =>
        this.parseNumber(this.accountInfo()?.user_info?.max_connections)
    );
    readonly connectionUsagePercent = computed(() => {
        const maxConnections = this.maxConnections();

        if (maxConnections <= 0) {
            return 0;
        }

        return Math.min(
            100,
            Math.round((this.activeConnections() / maxConnections) * 100)
        );
    });
    readonly activeConnectionsLabel = computed(
        () => `${this.activeConnections()}/${Math.max(this.maxConnections(), 0)}`
    );
    readonly formattedExpDate = computed(() =>
        this.formatUnixDate(this.accountInfo()?.user_info?.exp_date)
    );
    readonly formattedCreatedDate = computed(() =>
        this.formatUnixDate(this.accountInfo()?.user_info?.created_at)
    );
    readonly allowedFormats = computed(
        () => this.accountInfo()?.user_info?.allowed_output_formats ?? []
    );
    readonly ports = computed<AccountPort[]>(() => {
        const serverInfo = this.accountInfo()?.server_info;

        return [
            {
                labelKey: 'XTREAM.ACCOUNT_INFO.HTTP_PORT',
                value: serverInfo?.port || '-',
            },
            {
                labelKey: 'XTREAM.ACCOUNT_INFO.HTTPS_PORT',
                value: serverInfo?.https_port || '-',
            },
            {
                labelKey: 'XTREAM.ACCOUNT_INFO.RTMP_PORT',
                value: serverInfo?.rtmp_port || '-',
            },
        ];
    });
    readonly heroStats = computed<AccountStat[]>(() => [
        {
            icon: 'bolt',
            labelKey: 'XTREAM.ACCOUNT_INFO.ACTIVE_CONNECTIONS',
            value: this.activeConnectionsLabel(),
            meter: this.connectionUsagePercent(),
        },
        {
            icon: 'live_tv',
            labelKey: 'XTREAM.ACCOUNT_INFO.LIVE_TV',
            value: String(this.liveStreamsCount),
            meter: null,
        },
        {
            icon: 'movie',
            labelKey: 'XTREAM.ACCOUNT_INFO.MOVIES',
            value: String(this.vodStreamsCount),
            meter: null,
        },
        {
            icon: 'tv',
            labelKey: 'XTREAM.ACCOUNT_INFO.TV_SERIES',
            value: String(this.seriesCount),
            meter: null,
        },
    ]);
    readonly userDetails = computed<AccountDetailRow[]>(() => [
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.STATUS',
            value: this.accountInfo()?.user_info?.status || '-',
            tone: this.isActive() ? 'positive' : undefined,
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.USERNAME',
            value: this.accountInfo()?.user_info?.username || '-',
            mono: true,
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.ACTIVE_CONNECTIONS',
            value: this.activeConnectionsLabel(),
            tone: 'accent',
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.CREATED',
            value: this.formattedCreatedDate(),
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.EXPIRES',
            value: this.formattedExpDate(),
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.TRIAL_ACCOUNT',
            value: this.isTrial()
                ? 'XTREAM.ACCOUNT_INFO.YES'
                : 'XTREAM.ACCOUNT_INFO.NO',
            translateValue: true,
            tone: this.isTrial() ? 'warning' : undefined,
        },
    ]);
    readonly serverDetails = computed<AccountDetailRow[]>(() => [
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.URL',
            value: this.accountInfo()?.server_info?.url || '-',
            mono: true,
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.PROTOCOL',
            value: this.accountInfo()?.server_info?.server_protocol || '-',
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.TIMEZONE',
            value: this.accountInfo()?.server_info?.timezone || '-',
        },
        {
            labelKey: 'XTREAM.ACCOUNT_INFO.SERVER_TIME',
            value: this.accountInfo()?.server_info?.time_now || '-',
            mono: true,
        },
    ]);

    constructor() {
        void this.reload();
    }

    async reload(): Promise<void> {
        const playlist = this.currentPlaylist();

        if (!playlist) {
            this.loadState.set('error');
            this.accountInfo.set(null);
            return;
        }

        this.loadState.set('loading');

        try {
            const accountInfo = await this.xtreamApiService.getAccountInfo({
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            });

            this.accountInfo.set(accountInfo);
            this.loadState.set('ready');
        } catch (error) {
            this.logger.error('Failed to fetch account info', error);
            this.accountInfo.set(null);
            this.loadState.set('error');
        }
    }

    private formatUnixDate(timestamp?: string): string {
        const value = Number.parseInt(timestamp ?? '', 10);

        if (!Number.isFinite(value) || value <= 0) {
            return '-';
        }

        return new Date(value * 1000).toLocaleDateString();
    }

    private parseNumber(value?: string): number {
        const parsed = Number.parseInt(value ?? '', 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }
}

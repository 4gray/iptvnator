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
import { firstValueFrom } from 'rxjs';
import {
    isFullStalkerPortalPlaylist,
    normalizeStoredStalkerAccountInfo,
    StalkerAccountInfoService,
    StalkerAccountSnapshot,
} from '@iptvnator/portal/stalker/data-access';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    resetHostConnectivityGuard,
} from '@iptvnator/services';
import {
    isHostConnectivityFastFailMessage,
    PlaylistMeta,
    type StalkerAccountInfoDialogData,
} from '@iptvnator/shared/interfaces';

type AccountLoadState = 'loading' | 'ready' | 'error';

/** Where the currently displayed snapshot came from. */
type SnapshotSource = 'fresh' | 'cached';

interface AccountDetailRow {
    labelKey: string;
    value: string;
    mono?: boolean;
    tone?: 'positive' | 'warning';
}

interface AccountStat {
    icon: string;
    labelKey: string;
    value: string;
    warning?: boolean;
}

const DAY_IN_MS = 86_400_000;

@Component({
    selector: 'app-stalker-account-info',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './stalker-account-info.component.html',
    styleUrl: './stalker-account-info.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerAccountInfoComponent {
    private readonly data =
        inject<StalkerAccountInfoDialogData>(MAT_DIALOG_DATA);
    private readonly accountInfoService = inject(StalkerAccountInfoService);
    private readonly dataService = inject(DataService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly logger = createLogger('StalkerAccountInfo');

    readonly playlist: PlaylistMeta = this.data.playlist;
    /**
     * Presentation must use the same resolution as the fetch path: a
     * playlist restored from an older backup carries no explicit flag,
     * and the raw field would label a real Ministra portal as legacy.
     */
    readonly isFullPortal = isFullStalkerPortalPlaylist(this.playlist);
    readonly loadState = signal<AccountLoadState>('loading');
    readonly requestsPaused = signal(false);
    readonly snapshot = signal<StalkerAccountSnapshot | null>(null);
    readonly snapshotSource = signal<SnapshotSource | null>(null);
    readonly refreshFailed = signal(false);
    readonly skeletonStats = [1, 2, 3];
    readonly skeletonPanels = [1, 2];

    readonly playlistLabel = computed(
        () => this.playlist.title || this.playlist.portalUrl || '-'
    );
    readonly isCachedSnapshot = computed(
        () => this.snapshotSource() === 'cached'
    );
    /**
     * 1 = active, 0 = inactive is the convention of the panels that report
     * the field at all; anything else renders no pill instead of a guess.
     */
    readonly statusKind = computed<'active' | 'inactive' | null>(() => {
        const status = this.snapshot()?.status;
        if (status === 1) return 'active';
        if (status === 0) return 'inactive';
        return null;
    });
    readonly expiryDate = computed(() => {
        const expireDate = this.snapshot()?.expireDate;
        return expireDate ? new Date(expireDate * 1000) : null;
    });
    readonly daysLeft = computed(() => {
        const expiry = this.expiryDate();
        if (!expiry) {
            return null;
        }
        return Math.ceil((expiry.getTime() - Date.now()) / DAY_IN_MS);
    });
    /**
     * Read from the raw timestamp, not daysLeft: an expiry that passed
     * less than 24h ago rounds up to 0 (or -0), which is not negative, so
     * the counter would claim "0 days left" on a dead subscription.
     */
    readonly hasExpired = computed(() => {
        const expiry = this.expiryDate();
        return expiry ? expiry.getTime() <= Date.now() : false;
    });
    readonly expiresSoon = computed(() => {
        const daysLeft = this.daysLeft();
        return daysLeft !== null && daysLeft <= 7;
    });

    readonly heroStats = computed<AccountStat[]>(() => {
        const stats: AccountStat[] = [];
        const daysLeft = this.daysLeft();

        if (daysLeft !== null) {
            const expired = this.hasExpired();
            stats.push({
                icon: 'timer',
                labelKey: expired
                    ? 'STALKER.ACCOUNT_INFO.EXPIRED'
                    : 'STALKER.ACCOUNT_INFO.DAYS_LEFT',
                value: expired
                    ? this.formatDate(this.expiryDate())
                    : String(daysLeft),
                warning: this.expiresSoon(),
            });
        }

        const tariff = this.snapshot()?.tariffPlanName;
        if (tariff) {
            stats.push({
                icon: 'loyalty',
                labelKey: 'STALKER.ACCOUNT_INFO.TARIFF_PLAN',
                value: tariff,
            });
        }

        stats.push({
            icon: 'router',
            labelKey: 'STALKER.ACCOUNT_INFO.MAC_ADDRESS',
            value: this.snapshot()?.mac || this.playlist.macAddress || '-',
        });

        return stats;
    });

    readonly accountDetails = computed<AccountDetailRow[]>(() => {
        const snapshot = this.snapshot();
        if (!snapshot) {
            return [];
        }

        const rows: AccountDetailRow[] = [];
        const statusKind = this.statusKind();

        if (statusKind) {
            rows.push({
                labelKey: 'STALKER.ACCOUNT_INFO.STATUS',
                value:
                    statusKind === 'active'
                        ? 'STALKER.ACCOUNT_INFO.ACTIVE'
                        : 'STALKER.ACCOUNT_INFO.INACTIVE',
                tone: statusKind === 'active' ? 'positive' : 'warning',
            });
        }
        if (snapshot.login) {
            rows.push({
                labelKey: 'STALKER.ACCOUNT_INFO.LOGIN',
                value: snapshot.login,
                mono: true,
            });
        }
        if (snapshot.tariffPlanName) {
            rows.push({
                labelKey: 'STALKER.ACCOUNT_INFO.TARIFF_PLAN',
                value: snapshot.tariffPlanName,
            });
        }
        if (this.expiryDate()) {
            rows.push({
                labelKey: 'STALKER.ACCOUNT_INFO.EXPIRES',
                value: this.formatDate(this.expiryDate()),
                tone: this.expiresSoon() ? 'warning' : undefined,
            });
        }
        if (snapshot.phone) {
            rows.push({
                labelKey: 'STALKER.ACCOUNT_INFO.PHONE',
                value: snapshot.phone,
                mono: true,
            });
        }

        return rows;
    });

    readonly portalDetails = computed<AccountDetailRow[]>(() => [
        {
            labelKey: 'STALKER.ACCOUNT_INFO.PORTAL_URL',
            value: this.playlist.portalUrl || '-',
            mono: true,
        },
        {
            labelKey: 'STALKER.ACCOUNT_INFO.MAC_ADDRESS',
            value: this.playlist.macAddress || '-',
            mono: true,
        },
    ]);

    readonly translatedRowKeys: ReadonlySet<string> = new Set([
        'STALKER.ACCOUNT_INFO.ACTIVE',
        'STALKER.ACCOUNT_INFO.INACTIVE',
    ]);

    constructor() {
        void this.load();
    }

    /**
     * The template's Retry button. Clears the connectivity guard first, for the
     * same reason as every other explicit retry: the profile request is what a
     * tripped guard fast-fails. Opening the dialog does not reset — only a user
     * action means "contact this host now".
     */
    async reload(): Promise<void> {
        await resetHostConnectivityGuard(
            this.dataService,
            this.playlist?.portalUrl
        );
        await this.load();
    }

    private async load(): Promise<void> {
        this.requestsPaused.set(false);
        this.refreshFailed.set(false);
        if (!this.snapshot()) {
            this.loadState.set('loading');
        }

        await this.loadCachedSnapshot();

        try {
            const fresh = await this.accountInfoService.fetchAccountInfo(
                this.playlist
            );
            if (fresh) {
                this.snapshot.set(fresh);
                this.snapshotSource.set('fresh');
            }
            this.loadState.set('ready');
        } catch (error) {
            this.requestsPaused.set(
                isHostConnectivityFastFailMessage(
                    error instanceof Error ? error.message : error
                )
            );
            this.logger.error('Failed to fetch account info', error);
            if (this.snapshot()) {
                // Keep showing the cached snapshot; just flag the refresh.
                this.refreshFailed.set(true);
                this.loadState.set('ready');
            } else {
                this.loadState.set('error');
            }
        }
    }

    private async loadCachedSnapshot(): Promise<void> {
        if (this.snapshot()) {
            return;
        }

        try {
            const playlist = await firstValueFrom(
                this.playlistsService.getPlaylist(this.playlist._id)
            );
            // The import path persists portal values verbatim, so the
            // stored expiry may be a date string or milliseconds despite
            // the declared type — normalize before rendering.
            const cached = normalizeStoredStalkerAccountInfo(
                playlist?.stalkerAccountInfo
            );
            if (cached) {
                this.snapshot.set(cached);
                this.snapshotSource.set('cached');
                this.loadState.set('ready');
            }
        } catch (error) {
            // Cache miss is non-fatal — the fresh fetch decides the state.
            this.logger.warn('Failed to read cached account info', error);
        }
    }

    private formatDate(date: Date | null): string {
        return date ? date.toLocaleDateString() : '-';
    }
}

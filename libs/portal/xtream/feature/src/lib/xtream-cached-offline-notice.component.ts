import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { DataService, resetHostConnectivityGuard } from '@iptvnator/services';

const NOTICE_STATES = {
    unavailable: {
        key: 'PORTAL_UNAVAILABLE',
        icon: 'cloud_off',
        tone: 'warning',
    },
    expired: { key: 'ACCOUNT_EXPIRED', icon: 'event_busy', tone: 'error' },
    inactive: { key: 'ACCOUNT_INACTIVE', icon: 'block', tone: 'error' },
} as const;

@Component({
    selector: 'app-xtream-cached-offline-notice',
    imports: [MatButtonModule, MatIconModule, TranslatePipe],
    template: `
        @if (notice(); as state) {
            <div
                class="xtream-cached-offline-notice"
                [class.xtream-cached-offline-notice--error]="
                    state.tone === 'error'
                "
                [class.xtream-cached-offline-notice--checking]="isChecking()"
                [attr.data-status]="isChecking() ? 'checking' : state.status"
                [attr.aria-busy]="isChecking()"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-test-id="xtream-offline-warning"
                data-testid="xtream-offline-warning"
            >
                <mat-icon aria-hidden="true">{{
                    isChecking() ? 'sync' : state.icon
                }}</mat-icon>
                <div class="xtream-cached-offline-notice__copy">
                    <strong>{{
                        (isChecking()
                            ? 'PORTALS.STATUS_NOTICE.CHECKING'
                            : state.titleKey
                        ) | translate
                    }}</strong>
                    <span>{{
                        'PORTALS.STATUS_NOTICE.CACHED_DESCRIPTION' | translate
                    }}</span>
                </div>
                <button
                    mat-flat-button
                    class="xtream-cached-offline-notice__retry"
                    type="button"
                    [disabled]="isChecking()"
                    (click)="checkAgain()"
                >
                    {{
                        (isChecking()
                            ? 'PORTALS.STATUS_NOTICE.CHECKING'
                            : 'SOURCE_HEALTH.RECHECK'
                        ) | translate
                    }}
                </button>
            </div>
        }
    `,
    styleUrl: './xtream-cached-offline-notice.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamCachedOfflineNoticeComponent {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly dataService = inject(DataService);

    readonly isChecking = signal(false);
    readonly notice = computed(() => {
        const status = this.xtreamStore.portalStatus();
        if (
            status === 'active' ||
            !this.xtreamStore.isContentInitialized() ||
            this.xtreamStore.contentInitBlockReason()
        ) {
            return null;
        }
        const state = NOTICE_STATES[status];
        return {
            ...state,
            status,
            titleKey: `PORTALS.ERROR_VIEW.${state.key}.TITLE`,
        };
    });

    async checkAgain(): Promise<void> {
        if (this.isChecking()) return;
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) return;

        this.isChecking.set(true);
        try {
            await resetHostConnectivityGuard(
                this.dataService,
                playlist.serverUrl
            );
            // A source switch/edit during the reset must not check a new account.
            if (this.xtreamStore.currentPlaylist() !== playlist) return;
            await this.xtreamStore.checkPortalStatus();
        } finally {
            this.isChecking.set(false);
        }
    }
}

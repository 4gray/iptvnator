import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistErrorViewComponent } from '@iptvnator/portal/shared/ui';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { XtreamCachedOfflineNoticeComponent } from './xtream-cached-offline-notice.component';

@Component({
    selector: 'app-xtream-content-gate',
    standalone: true,
    imports: [
        PlaylistErrorViewComponent,
        RouterOutlet,
        TranslatePipe,
        XtreamCachedOfflineNoticeComponent,
    ],
    template: `
        @if (effectiveBlockReason(); as blockReason) {
            <div class="xtream-content-gate">
                <app-playlist-error-view
                    [title]="titleKey() | translate"
                    [description]="descriptionKey() | translate"
                    [variant]="
                        blockReason === 'unavailable' ? 'offline' : 'error'
                    "
                    [retryable]="true"
                    (retry)="retryContentInitialization()"
                />
            </div>
        } @else {
            <app-xtream-cached-offline-notice />
            <div
                class="xtream-route-content"
                [attr.data-xtream-catalog-ready]="catalogReady()"
            >
                <router-outlet />
            </div>
        }
    `,
    styleUrls: [
        './xtream-status-layout.scss',
        './xtream-content-gate.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamContentGateComponent {
    private readonly xtreamStore = inject(XtreamStore);

    readonly contentInitBlockReason = this.xtreamStore.contentInitBlockReason;
    protected readonly catalogReady = computed(
        () =>
            this.xtreamStore.isContentInitialized() &&
            !this.xtreamStore.activeImportSessionId()
    );
    readonly effectiveBlockReason = computed(() =>
        this.xtreamStore.isContentBlocked()
            ? (this.contentInitBlockReason() ?? 'error')
            : null
    );
    private readonly errorViewKey = computed(() => {
        switch (this.effectiveBlockReason()) {
            case 'cancelled':
                return 'IMPORT_CANCELLED';
            case 'expired':
                return 'ACCOUNT_EXPIRED';
            case 'inactive':
                return 'ACCOUNT_INACTIVE';
            case 'unavailable':
                return 'PORTAL_UNAVAILABLE';
            case 'response-too-large':
                return 'PROVIDER_RESPONSE_TOO_LARGE';
            case 'error':
            default:
                return 'UNKNOWN_ERROR';
        }
    });
    readonly titleKey = computed(
        () => `PORTALS.ERROR_VIEW.${this.errorViewKey()}.TITLE`
    );
    readonly descriptionKey = computed(
        () => `PORTALS.ERROR_VIEW.${this.errorViewKey()}.DESCRIPTION`
    );

    retryContentInitialization(): void {
        void this.xtreamStore.retryContentInitialization();
    }
}

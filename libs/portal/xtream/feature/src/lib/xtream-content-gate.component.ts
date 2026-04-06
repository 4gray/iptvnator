import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    PlaylistErrorViewComponent,
} from '@iptvnator/portal/shared/ui';
import {
    XtreamContentInitBlockReason,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { XtreamCachedOfflineNoticeComponent } from './xtream-cached-offline-notice.component';

@Component({
    selector: 'app-xtream-content-gate',
    standalone: true,
    imports: [
        MatButtonModule,
        MatIconModule,
        PlaylistErrorViewComponent,
        RouterOutlet,
        TranslatePipe,
        XtreamCachedOfflineNoticeComponent,
    ],
    template: `
        @if (contentInitBlockReason(); as blockReason) {
            <div class="xtream-content-gate">
                <app-playlist-error-view
                    [title]="titleKey() | translate"
                    [description]="descriptionKey() | translate"
                />

                <div class="xtream-content-gate__actions">
                    <button
                        mat-flat-button
                        color="primary"
                        type="button"
                        (click)="retryContentInitialization()"
                    >
                        <mat-icon>refresh</mat-icon>
                        {{ 'DOWNLOADS.RETRY' | translate }}
                    </button>
                </div>
            </div>
        } @else {
            <app-xtream-cached-offline-notice />
            <router-outlet />
        }
    `,
    styles: [
        `
            .xtream-content-gate {
                display: grid;
                gap: 16px;
                justify-items: center;
                padding: 24px;
            }

            .xtream-content-gate__actions {
                display: flex;
                justify-content: center;
            }
        `,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamContentGateComponent {
    private readonly xtreamStore = inject(XtreamStore);

    readonly contentInitBlockReason = this.xtreamStore.contentInitBlockReason;
    private readonly errorViewKey = computed(() => {
        switch (this.contentInitBlockReason()) {
            case 'cancelled':
                return 'IMPORT_CANCELLED';
            case 'expired':
                return 'ACCOUNT_EXPIRED';
            case 'inactive':
                return 'ACCOUNT_INACTIVE';
            case 'unavailable':
                return 'PORTAL_UNAVAILABLE';
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

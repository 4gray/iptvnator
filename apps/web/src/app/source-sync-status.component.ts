import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    sourceConnection,
    sourceConnectionReadFailed,
} from '@iptvnator/services/source-sync/connection';
import { SourceSyncStatusViewComponent } from './source-sync-status-view.component';

/** Keep server controls and Material off the standalone startup path. */
@Component({
    selector: 'app-source-sync-status',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [SourceSyncStatusViewComponent, TranslatePipe],
    template: `
        @defer (when available) {
            <app-source-sync-status-view />
        } @error {
            @if (available) {
                <section role="alert">
                    <span>{{
                        'SOURCE_SYNC.CONNECTION_RECOVERY' | translate
                    }}</span>
                    <button type="button" (click)="openSettings()">
                        {{ 'SOURCE_SYNC.TITLE' | translate }}
                    </button>
                </section>
            }
        }
    `,
    styleUrl: './source-sync-status.component.scss',
})
export class SourceSyncStatusComponent {
    readonly available = !!sourceConnection() || sourceConnectionReadFailed();
    private readonly router = inject(Router);

    openSettings(): void {
        void this.router.navigateByUrl('/workspace/settings/server');
    }
}

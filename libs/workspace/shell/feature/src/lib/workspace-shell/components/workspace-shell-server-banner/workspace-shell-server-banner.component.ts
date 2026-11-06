import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';

/**
 * Self-hosted server storage is unreachable: the library on screen is the
 * last copy this browser read, and changes cannot be saved. Styled by the
 * workspace shell's stylesheet (see there why).
 */
@Component({
    selector: 'app-workspace-shell-server-banner',
    imports: [MatButtonModule, MatIcon, TranslatePipe],
    template: `
        @if (status.state() === 'offline') {
            <div
                class="server-banner"
                role="status"
                data-test-id="server-offline-banner"
            >
                <mat-icon aria-hidden="true">cloud_off</mat-icon>
                <span class="server-banner__text">{{
                    'SERVER_STORAGE.OFFLINE_BANNER' | translate
                }}</span>
                <button
                    mat-stroked-button
                    type="button"
                    (click)="status.retry()"
                    data-test-id="server-offline-retry"
                >
                    {{ 'SERVER_STORAGE.RETRY' | translate }}
                </button>
            </div>
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellServerBannerComponent {
    readonly status = inject(ServerStorageStatusService);
}

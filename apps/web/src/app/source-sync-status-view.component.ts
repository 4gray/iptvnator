import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import {
    SourceSyncService,
    tokenKey,
    disconnectBrowserSourceConnection,
} from '@iptvnator/services/source-sync';

/** Available even when a first inventory read prevents workspace startup. */
@Component({
    selector: 'app-source-sync-status-view',
    imports: [FormsModule, MatButtonModule, TranslateModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (sync.connectionReadFailed) {
            <section
                role="alert"
                class="server-status"
                data-test-id="source-connection-recovery"
            >
                <span>{{ 'SOURCE_SYNC.CONNECTION_RECOVERY' | translate }}</span>
                <a mat-button routerLink="/workspace/settings/server">{{
                    'SOURCE_SYNC.TITLE' | translate
                }}</a>
            </section>
        }
        @if (sync.connection && sync.state() !== 'connected') {
            <section
                role="status"
                class="server-status"
                data-test-id="source-sync-status"
            >
                <span>{{
                    sync.errorKey() || sync.stateKey() | translate
                }}</span>
                <a mat-button routerLink="/workspace/settings/server">{{
                    'SOURCE_SYNC.TITLE' | translate
                }}</a>
                @if (sync.state() === 'locked') {
                    <label
                        >{{ 'SOURCE_SYNC.TOKEN' | translate }}
                        <input
                            type="password"
                            autocomplete="off"
                            [(ngModel)]="token"
                        />
                    </label>
                }
                <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy()"
                    (click)="retry()"
                >
                    {{ 'SOURCE_SYNC.REFRESH' | translate }}
                </button>
                <button
                    mat-button
                    type="button"
                    [disabled]="busy()"
                    (click)="disconnect()"
                >
                    {{ 'SOURCE_SYNC.DISCONNECT' | translate }}
                </button>
            </section>
        }
    `,
    styles: [
        `
            .server-status {
                position: relative;
                z-index: 20;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 12px;
                padding: 12px 20px;
                color: var(--app-on-surface);
                background: var(--app-widget-bg);
            }
            button,
            a,
            input {
                app-region: no-drag;
            }
            input {
                color: var(--app-on-surface);
                background: var(--app-content-bg);
            }
        `,
    ],
})
export class SourceSyncStatusViewComponent {
    readonly sync = inject(SourceSyncService);
    readonly busy = signal(false);
    token = '';

    async retry(): Promise<void> {
        this.busy.set(true);
        try {
            if (this.token && this.sync.connection) {
                if (window.electron?.sourceSyncConfigure)
                    await window.electron.sourceSyncConfigure(
                        this.sync.connection.apiUrl,
                        this.token,
                        false
                    );
                else
                    sessionStorage.setItem(
                        tokenKey(this.sync.connection),
                        this.token
                    );
            }
            await this.sync.refresh();
        } catch {
            this.sync.state.set('locked');
        } finally {
            this.token = '';
            this.busy.set(false);
        }
    }

    async disconnect(): Promise<void> {
        if (window.electron?.sourceSyncDisconnect)
            await window.electron.sourceSyncDisconnect();
        else {
            disconnectBrowserSourceConnection();
            location.reload();
        }
    }
}

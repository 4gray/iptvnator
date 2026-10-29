import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import type { ElectronBridgeAppUpdateStatus } from '@iptvnator/shared/interfaces';
import { AppMaintenanceService } from './services/app-maintenance.service';

/** Loaded only on failure; maintenance must not inflate the normal launch path. */
@Component({
    selector: 'app-startup-recovery',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButton, TranslatePipe],
    template: `
        <button mat-flat-button type="button" (click)="retry()">
            {{ 'RETRY' | translate }}
        </button>
        <div class="startup-recovery-actions">
            <button
                mat-stroked-button
                type="button"
                data-test-id="startup-open-settings"
                (click)="maintenance.openSettings()"
            >
                {{ 'WORKSPACE.SHELL.OPEN_SETTINGS' | translate }}
            </button>
            @if (maintenance.canCheckForUpdates) {
                <button
                    mat-stroked-button
                    type="button"
                    data-test-id="startup-check-updates"
                    (click)="maintenance.checkForUpdates()"
                >
                    {{ 'STARTUP.CHECK_UPDATES' | translate }}
                </button>
            }
        </div>
        @if (info(); as current) {
            <p class="startup-version" data-test-id="startup-version">
                IPTVnator {{ current.currentVersion }} ·
                {{
                    (current.channel === 'nightly'
                        ? 'SETTINGS.APP_UPDATE_CHANNEL_NIGHTLY'
                        : 'SETTINGS.APP_UPDATE_CHANNEL_STABLE'
                    ) | translate
                }}
            </p>
        }
    `,
    styles: `
        :host {
            display: contents;
        }
        button,
        .startup-recovery-actions,
        p {
            position: relative;
            z-index: 1;
        }
        button {
            app-region: no-drag;
            margin-top: 8px;
        }
        .startup-recovery-actions {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 8px;
        }
        .startup-version {
            font-size: 12px;
            color: var(--app-body-color);
            margin: 16px 0 0;
        }
    `,
})
export class AppStartupRecoveryComponent {
    readonly maintenance = inject(AppMaintenanceService);
    private readonly store = inject(Store);
    readonly info = signal<ElectronBridgeAppUpdateStatus | null>(null);

    constructor() {
        void window.electron
            ?.getAppUpdateStatus?.()
            .then((status) => this.info.set(status))
            .catch(() => undefined);
    }

    retry(): void {
        this.store.dispatch(PlaylistActions.loadPlaylists());
    }
}

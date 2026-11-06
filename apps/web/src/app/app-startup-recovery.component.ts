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
        <button
            mat-flat-button
            class="startup-primary"
            type="button"
            (click)="retry()"
        >
            {{ 'RETRY' | translate }}
        </button>
        <div class="startup-recovery-actions">
            <button
                mat-flat-button
                type="button"
                class="startup-secondary"
                data-test-id="startup-open-settings"
                (click)="maintenance.openSettings()"
            >
                {{ 'WORKSPACE.SHELL.OPEN_SETTINGS' | translate }}
            </button>
            @if (maintenance.canCheckForUpdates) {
                <button
                    mat-flat-button
                    type="button"
                    class="startup-secondary"
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
                    (current.installedChannel === 'nightly'
                        ? 'SETTINGS.APP_UPDATE_CHANNEL_NIGHTLY'
                        : 'SETTINGS.APP_UPDATE_CHANNEL_STABLE'
                    ) | translate
                }}
            </p>
        }
    `,
    styleUrl: './app-startup-recovery.component.scss',
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

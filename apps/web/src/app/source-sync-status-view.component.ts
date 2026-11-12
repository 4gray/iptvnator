import { DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { SourceSyncService } from '@iptvnator/services/source-sync';

/** Available even when a first inventory read prevents workspace startup. */
@Component({
    selector: 'app-source-sync-status-view',
    imports: [MatButtonModule, MatIcon, TranslateModule, RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (sync.connectionReadFailed) {
            <section
                role="alert"
                class="server-status"
                data-test-id="source-connection-recovery"
            >
                <span class="server-status__message">{{
                    'SOURCE_SYNC.CONNECTION_RECOVERY' | translate
                }}</span>
                <a
                    mat-flat-button
                    class="server-status__primary"
                    routerLink="/workspace/settings/server"
                    >{{ 'SOURCE_SYNC.TITLE' | translate }}</a
                >
            </section>
        }
        @if (
            sync.connection &&
            sync.state() !== 'local' &&
            sync.state() !== 'connected' &&
            !(sync.state() === 'connecting' && sync.hasCachedLibrary) &&
            !(canDismiss() && dismissed())
        ) {
            <section class="server-status" data-test-id="source-sync-status">
                <span class="server-status__message" role="status">
                    {{
                        (canDismiss()
                            ? 'SOURCE_SYNC.CACHED_OFFLINE'
                            : sync.state() === 'connecting'
                              ? sync.stateKey()
                              : sync.errorKey() || sync.stateKey()
                        ) | translate
                    }}
                </span>
                <div class="server-status__actions">
                    @if (sync.state() === 'locked') {
                        <a
                            mat-flat-button
                            class="server-status__primary"
                            routerLink="/workspace/settings/server"
                            >{{ 'SOURCE_SYNC.OPEN_SETTINGS' | translate }}</a
                        >
                    } @else {
                        @if (!canDismiss()) {
                            <a
                                mat-flat-button
                                class="server-status__secondary"
                                routerLink="/workspace/settings/server"
                                >{{ 'SOURCE_SYNC.TITLE' | translate }}</a
                            >
                        }
                        <button
                            mat-flat-button
                            type="button"
                            [class.server-status__primary]="!canDismiss()"
                            [class.server-status__secondary]="canDismiss()"
                            [disabled]="busy() || sync.state() === 'connecting'"
                            [attr.aria-busy]="busy()"
                            (click)="retry()"
                        >
                            {{
                                (sync.state() === 'conflict'
                                    ? 'SOURCE_SYNC.REFRESH'
                                    : 'SOURCE_SYNC.RETRY_CONNECTION'
                                ) | translate
                            }}
                        </button>
                    }
                    @if (canDismiss()) {
                        <button
                            mat-icon-button
                            type="button"
                            class="server-status__dismiss"
                            [attr.aria-label]="
                                'SOURCE_SYNC.DISMISS_OFFLINE' | translate
                            "
                            [attr.title]="
                                'SOURCE_SYNC.DISMISS_OFFLINE' | translate
                            "
                            (click)="dismiss()"
                        >
                            <mat-icon aria-hidden="true">close</mat-icon>
                        </button>
                    }
                </div>
            </section>
        }
    `,
    styleUrl: './source-sync-status-view.component.scss',
})
export class SourceSyncStatusViewComponent {
    private readonly document = inject(DOCUMENT);
    readonly sync = inject(SourceSyncService);
    readonly busy = signal(false);
    readonly dismissed = signal(false);
    readonly canDismiss = computed(
        () =>
            this.sync.state() === 'offline' &&
            this.sync.hasCachedLibrary &&
            this.sync.errorKey() === 'SOURCE_SYNC.OFFLINE'
    );

    dismiss(): void {
        this.dismissed.set(true);
        this.document
            .querySelector<HTMLElement>('main.workspace-content')
            ?.focus({ preventScroll: true });
    }

    async retry(): Promise<void> {
        this.busy.set(true);
        try {
            await this.sync.refresh();
        } catch {
            this.sync.errorKey.set('SOURCE_SYNC.REQUEST_FAILED');
            this.sync.state.set('offline');
        } finally {
            this.busy.set(false);
        }
    }
}

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { PwaUpdateService } from './services/pwa-update.service';

@Component({
    selector: 'app-pwa-update-notification',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, TranslatePipe],
    template: `
        @if (updates.notice()) {
            <section
                class="app-update-notification"
                data-test-id="pwa-update-notification"
            >
                <header class="app-update-notification__header">
                    <span class="app-update-notification__title">
                        {{ 'SETTINGS.APP_UPDATE_TITLE' | translate }}
                    </span>
                </header>
                <div class="app-update-notification__body" role="status">
                    {{ message() | translate }}
                </div>
                <div class="app-update-notification__actions">
                    <button
                        mat-flat-button
                        type="button"
                        [disabled]="
                            updates.notice() === 'failed' && updates.checking()
                        "
                        (click)="updates.act()"
                    >
                        {{
                            (updates.notice() === 'failed'
                                ? 'RETRY'
                                : 'REFRESH'
                            ) | translate
                        }}
                    </button>
                </div>
            </section>
        }
    `,
    styleUrl: './app-update-notification-card.component.scss',
    // Keep the persistent action above the settings save bar and transient toasts.
    styles: [
        `
            .app-update-notification {
                bottom: calc(96px + env(safe-area-inset-bottom, 0px));
            }
            @media (max-width: 560px) {
                .app-update-notification {
                    bottom: calc(160px + env(safe-area-inset-bottom, 0px));
                }
            }
        `,
    ],
})
export class PwaUpdateNotificationComponent {
    readonly updates = inject(PwaUpdateService);
    readonly message = computed(() => {
        switch (this.updates.notice()) {
            case 'unrecoverable':
                return 'PWA_RELOAD_REQUIRED';
            case 'failed':
                return 'PWA_UPDATE_FAILED';
            default:
                return 'PWA_UPDATE_READY';
        }
    });
}

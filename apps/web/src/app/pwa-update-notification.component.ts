import { DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    inject,
    linkedSignal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { PwaUpdateService } from './services/pwa-update.service';

@Component({
    selector: 'app-pwa-update-notification',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatIcon, TranslatePipe],
    template: `
        @if (visibleNotice(); as notice) {
            <section
                class="app-update-notification app-update-notification--pwa"
                data-test-id="pwa-update-notification"
            >
                <header class="app-update-notification__header">
                    <span class="app-update-notification__title">
                        {{ 'SETTINGS.APP_UPDATE_TITLE' | translate }}
                    </span>
                    @if (notice !== 'unrecoverable') {
                        <button
                            mat-icon-button
                            type="button"
                            class="app-update-notification__close"
                            [attr.aria-label]="'CLOSE' | translate"
                            (click)="dismiss()"
                        >
                            <mat-icon aria-hidden="true">close</mat-icon>
                        </button>
                    }
                </header>
                <div class="app-update-notification__body" role="status">
                    {{ updates.noticeMessage() | translate }}
                </div>
                <div class="app-update-notification__actions">
                    <button
                        mat-flat-button
                        type="button"
                        [disabled]="notice === 'failed' && updates.checking()"
                        (click)="updates.act()"
                    >
                        {{
                            (notice === 'failed' ? 'RETRY' : 'REFRESH')
                                | translate
                        }}
                    </button>
                </div>
            </section>
        }
    `,
    styleUrl: './app-update-notification-card.component.scss',
})
export class PwaUpdateNotificationComponent {
    private readonly document = inject(DOCUMENT);
    protected readonly updates = inject(PwaUpdateService);
    protected readonly visibleNotice = linkedSignal(this.updates.notice);

    protected dismiss(): void {
        this.visibleNotice.set(null);
        this.document
            .querySelector<HTMLElement>('main.workspace-content')
            ?.focus({ preventScroll: true });
    }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

@Component({
    selector: 'app-xtream-cached-offline-notice',
    imports: [MatIconModule, TranslatePipe],
    template: `
        @if (showWarning()) {
            <div
                class="xtream-cached-offline-notice"
                data-test-id="xtream-offline-warning"
                data-testid="xtream-offline-warning"
            >
                <mat-icon>cloud_off</mat-icon>

                <div class="xtream-cached-offline-notice__copy">
                    <strong>
                        {{
                            'PORTALS.ERROR_VIEW.PORTAL_UNAVAILABLE.TITLE'
                                | translate
                        }}
                    </strong>
                    <span>
                        {{
                            'PORTALS.ERROR_VIEW.PORTAL_UNAVAILABLE.DESCRIPTION'
                                | translate
                        }}
                    </span>
                </div>
            </div>
        }
    `,
    styles: [
        `
            .xtream-cached-offline-notice {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                margin: 0 0 12px;
                padding: 12px 14px;
                border-radius: 12px;
                background: var(--mat-sys-error-container);
                color: var(--mat-sys-on-error-container);
            }

            .xtream-cached-offline-notice__copy {
                display: grid;
                gap: 4px;
            }

            .xtream-cached-offline-notice__copy strong {
                font-size: 0.92rem;
                font-weight: 700;
                line-height: 1.2;
            }

            .xtream-cached-offline-notice__copy span {
                font-size: 0.84rem;
                line-height: 1.35;
            }

            .xtream-cached-offline-notice mat-icon {
                margin-top: 1px;
                flex-shrink: 0;
            }
        `,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamCachedOfflineNoticeComponent {
    private readonly xtreamStore = inject(XtreamStore);

    readonly showWarning = computed(
        () =>
            this.xtreamStore.portalStatus() === 'unavailable' &&
            this.xtreamStore.isContentInitialized() &&
            !this.xtreamStore.contentInitBlockReason()
    );
}

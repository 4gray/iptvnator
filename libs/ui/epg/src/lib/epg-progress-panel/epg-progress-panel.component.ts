import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgressService } from '@iptvnator/epg/data-access';
import { EpgProgressPanelViewComponent } from './epg-progress-panel-view.component';

/**
 * Mounted by the app shell on every launch, but the panel has nothing to
 * show until an EPG import starts. The view, with its Material tooltip,
 * progress bar, icon and dialog, is therefore loaded when the first import
 * makes the panel visible instead of with the app. Should that chunk fail
 * to load, a notice takes the panel's place while an import is running, so
 * the import and its errors do not go unreported.
 */
@Component({
    selector: 'app-epg-progress-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [EpgProgressPanelViewComponent, TranslatePipe],
    template: `
        @defer (when isVisible()) {
            <app-epg-progress-panel-view />
        } @error {
            @if (isVisible()) {
                <div class="epg-progress-panel-unavailable" role="alert">
                    {{ 'EPG.IMPORT_PANEL_UNAVAILABLE' | translate }}
                </div>
            }
        }
    `,
    styles: `
        .epg-progress-panel-unavailable {
            position: fixed;
            bottom: 20px;
            left: 76px;
            z-index: 900;
            width: 300px;
            max-width: calc(100vw - 96px);
            padding: 10px 12px;
            border: 1px solid var(--app-separator);
            border-radius: 12px;
            background: var(--app-widget-bg);
            color: var(--app-body-color);
            font-size: 0.78rem;
            line-height: 1.4;
        }
        @media (max-width: 640px) {
            .epg-progress-panel-unavailable {
                left: 12px;
            }
        }
    `,
})
export class EpgProgressPanelComponent {
    readonly isVisible = inject(EpgProgressService).isVisible;
}

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
    styleUrl: './epg-progress-panel.component.scss',
})
export class EpgProgressPanelComponent {
    readonly isVisible = inject(EpgProgressService).isVisible;
}

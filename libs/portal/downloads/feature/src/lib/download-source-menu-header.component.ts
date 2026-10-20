import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-download-source-menu-header',
    imports: [MatTooltip, TranslatePipe],
    template: `
        @if (sourceName().trim(); as source) {
            <div class="download-source-menu-header">
                <span>
                    {{ 'PORTALS.MULTI_SOURCE.SOURCE' | translate }}
                </span>
                <strong [matTooltip]="source">{{ source }}</strong>
            </div>
        }
    `,
    styles: `
        :host {
            display: block;
        }

        // Lines up with the kit menu rows (10px inline padding) and uses the
        // kit's section label for the caption.
        .download-source-menu-header {
            display: grid;
            gap: 2px;
            padding: 6px 10px 8px;

            span {
                color: var(--app-muted-color);
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.06em;
                text-transform: uppercase;
            }

            strong {
                overflow: hidden;
                color: var(--app-heading-color);
                font-size: 13px;
                font-weight: 600;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadSourceMenuHeaderComponent {
    readonly sourceName = input('');
}

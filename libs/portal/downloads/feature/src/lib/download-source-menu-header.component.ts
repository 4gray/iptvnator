import {
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
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

        .download-source-menu-header {
            display: grid;
            gap: 2px;
            max-width: 280px;
            padding: 10px 16px 8px;
            color: var(--mat-sys-on-surface-variant);

            span {
                font: var(--mat-sys-label-small);
                letter-spacing: 0.03em;
            }

            strong {
                overflow: hidden;
                color: var(--mat-sys-on-surface);
                font: var(--mat-sys-label-large);
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

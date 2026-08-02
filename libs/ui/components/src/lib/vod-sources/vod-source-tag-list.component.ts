import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { VodSourceRowTag } from './vod-source-tags';

/**
 * Renders a list of `VodSourceRowTag`s — the one shared way multi-source tags
 * reach the screen, so the full parent row and the compact copy row cannot
 * drift in how they present a guess, a fact, or a probe verdict.
 *
 * `display: contents` keeps the tags direct flex items of whatever container
 * hosts the component, so it adds markup without adding layout.
 */
@Component({
    selector: 'app-vod-source-tag-list',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIcon, TranslatePipe],
    styleUrl: './vod-source-tag-list.component.scss',
    template: `
        @for (tag of tags(); track tag.id) {
            <span
                class="source-tag"
                [class.source-tag--ok]="tag.tone === 'ok'"
                [class.source-tag--warn]="tag.tone === 'warn'"
                [class.source-tag--bad]="tag.tone === 'bad'"
            >
                @if (tag.spinner) {
                    <span class="source-tag__spinner" aria-hidden="true"></span>
                } @else if (tag.icon) {
                    <mat-icon class="source-tag__icon">{{ tag.icon }}</mat-icon>
                }
                @if (tag.prefix) {
                    <span class="source-tag__prefix">{{ tag.prefix }}</span>
                }
                @if (tag.labelKey) {
                    <span>{{ tag.labelKey | translate }}</span>
                } @else {
                    <span>{{ tag.text }}</span>
                }
                @if (tag.suffix) {
                    <span class="source-tag__suffix">{{ tag.suffix }}</span>
                }
            </span>
        }
    `,
})
export class VodSourceTagListComponent {
    readonly tags = input.required<VodSourceRowTag[]>();
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The heading row every details-page section shares (Episodes, Cast & crew,
 * Similar): an 18px title, an optional muted counter, and two projection
 * slots — `[section-header-lead]` right after the title (the season picker)
 * and `[section-header-end]` pushed to the far edge (view toggle, arrows).
 */
@Component({
    selector: 'app-detail-section-header',
    template: `
        <h3
            class="section-header__title"
            [attr.id]="headingId()"
            [attr.data-test-id]="titleTestId()"
        >
            {{ title() }}
        </h3>
        <ng-content select="[section-header-lead]" />
        @if (count() !== null && count() !== '') {
            <span class="section-header__count">{{ count() }}</span>
        }
        <div class="section-header__end">
            <ng-content select="[section-header-end]" />
        </div>
    `,
    styleUrl: './detail-section-header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailSectionHeaderComponent {
    readonly title = input.required<string>();
    readonly count = input<number | string | null>(null);
    readonly headingId = input<string | null>(null);
    readonly titleTestId = input<string | null>(null);
}

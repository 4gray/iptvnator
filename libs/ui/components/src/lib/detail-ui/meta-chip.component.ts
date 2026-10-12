import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type MetaChipVariant = 'default' | 'rating' | 'status';

/**
 * Pill meta chip shared by the VOD details hero and the dashboard hero
 * ("2026", "1 h 52 min", "★ 7.3", "Season 2", "Returning").
 *
 * A facet that opens the discover page keeps its keyboard behaviour as a
 * projected `<button class="meta-chip__facet">`; several facets in one chip
 * ("Thriller · Drama") are separated by `.meta-chip__sep`.
 */
@Component({
    selector: 'app-meta-chip',
    template: '<ng-content />',
    styleUrl: './meta-chip.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'meta-chip',
        '[class.meta-chip--rating]': 'variant() === "rating"',
        '[class.meta-chip--status]': 'variant() === "status"',
    },
})
export class MetaChipComponent {
    readonly variant = input<MetaChipVariant>('default');
}

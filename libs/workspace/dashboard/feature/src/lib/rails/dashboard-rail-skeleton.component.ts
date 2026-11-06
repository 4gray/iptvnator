import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { DashboardRailLayout } from './dashboard-rail.component';
import { SKELETON_CARDS_PER_RAIL } from './dashboard-rail.utils';

/**
 * Placeholder for one dashboard rail while its data loads. It takes the
 * `layout` and `aspectRatio` of the rail it stands in for and sizes its
 * header, track and cards from the rail's own geometry partial, so the rail
 * replaces it at the same height (see Loading States in the UI guidelines).
 */
@Component({
    selector: 'lib-dashboard-rail-skeleton',
    templateUrl: './dashboard-rail-skeleton.component.html',
    styleUrl: './dashboard-rail-skeleton.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRailSkeletonComponent {
    readonly layout = input<DashboardRailLayout>('cover');
    readonly aspectRatio = input<string>('2 / 3');
    readonly testId = input<string | null>(null);

    readonly slots = SKELETON_CARDS_PER_RAIL;
}

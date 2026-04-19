import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
    UnifiedCollectionDetailDirective,
    UnifiedCollectionPageComponent,
} from '@iptvnator/portal/shared/ui';
import { CollectionScope } from '@iptvnator/portal/shared/util';
import { StalkerCollectionDetailComponent } from '@iptvnator/portal/stalker/feature';
import { XtreamCollectionDetailComponent } from '@iptvnator/portal/xtream/feature';

@Component({
    selector: 'app-global-collection-route',
    imports: [
        StalkerCollectionDetailComponent,
        UnifiedCollectionDetailDirective,
        UnifiedCollectionPageComponent,
        XtreamCollectionDetailComponent,
    ],
    template: `
        <app-unified-collection-page
            [mode]="mode()"
            [defaultScope]="defaultScope()"
        >
            <ng-template unifiedCollectionDetail let-item let-close="close">
                @if (item.sourceType === 'xtream') {
                    <app-xtream-collection-detail [item]="item" />
                } @else if (item.sourceType === 'stalker') {
                    <app-stalker-collection-detail
                        [item]="item"
                        (closeRequested)="close()"
                    />
                }
            </ng-template>
        </app-unified-collection-page>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalCollectionRouteComponent {
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly defaultScope = input<CollectionScope | undefined>(undefined);
}

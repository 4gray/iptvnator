import {
    inject,
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
    UnifiedCollectionDetailDirective,
    UnifiedCollectionPageComponent,
} from '@iptvnator/portal/shared/ui';
import { routeParamSignal } from '@iptvnator/portal/shared/util';
import { StalkerCollectionDetailComponent } from './stalker-collection-detail.component';

@Component({
    selector: 'app-stalker-collection-route',
    imports: [
        StalkerCollectionDetailComponent,
        UnifiedCollectionDetailDirective,
        UnifiedCollectionPageComponent,
    ],
    template: `
        <app-unified-collection-page
            [mode]="mode()"
            [portalType]="portalType()"
            [playlistId]="playlistId()"
        >
            <ng-template unifiedCollectionDetail let-item let-close="close">
                <app-stalker-collection-detail
                    [item]="item"
                    (closeRequested)="close()"
                />
            </ng-template>
        </app-unified-collection-page>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerCollectionRouteComponent {
    private readonly route = inject(ActivatedRoute);

    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input('stalker');
    readonly playlistId = routeParamSignal<string | undefined>(
        this.route,
        'id',
        (value) => value ?? undefined
    );
}

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
import { XtreamCachedOfflineNoticeComponent } from './xtream-cached-offline-notice.component';
import { XtreamCollectionDetailComponent } from './xtream-collection-detail.component';

@Component({
    selector: 'app-xtream-collection-route',
    imports: [
        UnifiedCollectionDetailDirective,
        UnifiedCollectionPageComponent,
        XtreamCachedOfflineNoticeComponent,
        XtreamCollectionDetailComponent,
    ],
    template: `
        <app-xtream-cached-offline-notice />
        <div class="xtream-route-content">
            <app-unified-collection-page
                [mode]="mode()"
                [portalType]="portalType()"
                [playlistId]="playlistId()"
            >
                <ng-template unifiedCollectionDetail let-item>
                    <app-xtream-collection-detail [item]="item" />
                </ng-template>
            </app-unified-collection-page>
        </div>
    `,
    styleUrl: './xtream-status-layout.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamCollectionRouteComponent {
    private readonly route = inject(ActivatedRoute);

    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input('xtream');
    readonly playlistId = routeParamSignal<string | undefined>(
        this.route,
        'id',
        (value) => value ?? undefined
    );
}

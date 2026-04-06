import {
    inject,
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UnifiedCollectionPageComponent } from '@iptvnator/portal/shared/ui';
import { routeParamSignal } from '@iptvnator/portal/shared/util';
import { XtreamCachedOfflineNoticeComponent } from './xtream-cached-offline-notice.component';

@Component({
    selector: 'app-xtream-collection-route',
    imports: [
        UnifiedCollectionPageComponent,
        XtreamCachedOfflineNoticeComponent,
    ],
    template: `
        <app-xtream-cached-offline-notice />
        <app-unified-collection-page
            [mode]="mode()"
            [portalType]="portalType()"
            [playlistId]="playlistId()"
        />
    `,
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

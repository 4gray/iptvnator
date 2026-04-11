import {
    inject,
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UnifiedCollectionPageComponent } from '@iptvnator/portal/shared/ui';
import {
    CollectionScope,
    routeParamSignal,
} from '@iptvnator/portal/shared/util';

@Component({
    selector: 'app-m3u-collection-route',
    imports: [UnifiedCollectionPageComponent],
    template: `
        <app-unified-collection-page
            [mode]="mode()"
            [portalType]="portalType()"
            [playlistId]="playlistId()"
            [defaultScope]="defaultScope()"
        />
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uCollectionRouteComponent {
    private readonly route = inject(ActivatedRoute);

    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input('m3u');
    readonly defaultScope = input<CollectionScope | undefined>(undefined);
    readonly playlistId = routeParamSignal<string | undefined>(
        this.route,
        'id',
        (value) => value ?? undefined
    );
}

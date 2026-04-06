import {
    inject,
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UnifiedCollectionPageComponent } from '@iptvnator/portal/shared/ui';
import { routeParamSignal } from '@iptvnator/portal/shared/util';

@Component({
    selector: 'app-stalker-collection-route',
    imports: [UnifiedCollectionPageComponent],
    template: `
        <app-unified-collection-page
            [mode]="mode()"
            [portalType]="portalType()"
            [playlistId]="playlistId()"
        />
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

import {
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { UnifiedCollectionPageComponent } from '@iptvnator/portal/shared/ui';

@Component({
    selector: 'app-xtream-collection-route',
    imports: [UnifiedCollectionPageComponent],
    template: `
        <app-unified-collection-page
            [mode]="mode()"
            [portalType]="portalType()"
        />
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XtreamCollectionRouteComponent {
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly portalType = input('xtream');
}

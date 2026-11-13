import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Holds the player's place while a multiview session covers it. The stage
 * measures this element; it is black like the player it stands in for.
 * Styled through host bindings so no stylesheet is added.
 */
@Component({
    selector: 'app-multiview-anchor-placeholder',
    template: '',
    host: {
        'data-test-id': 'multiview-anchor-placeholder',
        '[style.display]': '"block"',
        '[style.width]': '"100%"',
        '[style.height]': '"100%"',
        '[style.background]': '"#000"',
    },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiviewAnchorPlaceholderComponent {}

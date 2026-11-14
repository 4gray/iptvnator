import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    type OnInit,
    inject,
    input,
} from '@angular/core';
import type { MultiviewAnchor } from './multiview-anchor';

/**
 * Holds the player's place while a multiview session covers it; the stage
 * measures this element. Black like the player it stands in for, styled
 * through host bindings so no stylesheet is added.
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
export class MultiviewAnchorPlaceholderComponent implements OnInit {
    readonly anchor = input.required<MultiviewAnchor>();
    private readonly element: HTMLElement = inject(ElementRef).nativeElement;
    private readonly destroyRef = inject(DestroyRef);

    ngOnInit(): void {
        const anchor = this.anchor();
        anchor.attach(this.element);
        this.destroyRef.onDestroy(() => anchor.detach(this.element));
    }
}

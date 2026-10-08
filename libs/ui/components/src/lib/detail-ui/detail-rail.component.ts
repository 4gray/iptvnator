import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    afterNextRender,
    inject,
    input,
    signal,
    viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

const SCROLL_STEP_PX = 450;

/**
 * A details-page row: heading, optional count, previous/next buttons and a
 * horizontal scroller with a hidden scrollbar. Hosts project the cards.
 * The arrows only render while the content overflows.
 */
@Component({
    selector: 'app-detail-rail',
    imports: [MatIcon, TranslatePipe],
    templateUrl: './detail-rail.component.html',
    styleUrl: './detail-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailRailComponent {
    readonly title = input.required<string>();
    readonly count = input<number | string | null>(null);
    readonly headingId = input<string | null>(null);

    readonly overflowing = signal(false);

    private readonly scroller =
        viewChild.required<ElementRef<HTMLElement>>('scroller');
    private readonly destroyRef = inject(DestroyRef);

    constructor() {
        afterNextRender(() => this.observeOverflow());
    }

    scrollBy(direction: -1 | 1): void {
        this.scroller().nativeElement.scrollBy({
            left: direction * SCROLL_STEP_PX,
            behavior: 'smooth',
        });
    }

    private observeOverflow(): void {
        const element = this.scroller().nativeElement;
        const measure = () =>
            this.overflowing.set(element.scrollWidth > element.clientWidth + 1);
        measure();
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        const mutations = new MutationObserver(measure);
        mutations.observe(element, { childList: true, subtree: true });
        this.destroyRef.onDestroy(() => {
            observer.disconnect();
            mutations.disconnect();
        });
    }
}

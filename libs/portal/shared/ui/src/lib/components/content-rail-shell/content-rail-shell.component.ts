import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Params, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Reusable horizontal-rail chrome: label + count badge + "see all" link,
 * scroll-snap track with projected cards, fade-in chevrons and edge gradients
 * that appear when scroll is possible. Matches the dashboard rail pattern so
 * any rail-style surface in the app reads as part of the same design system.
 *
 * Card markup is projected — callers supply whatever card component fits the
 * surface (simple poster tile, `app-content-card`, etc.). The shell only
 * owns the container, header, and navigation affordances.
 */
@Component({
    selector: 'app-content-rail-shell',
    standalone: true,
    imports: [MatIcon, RouterLink, TranslatePipe],
    templateUrl: './content-rail-shell.component.html',
    styleUrl: './content-rail-shell.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentRailShellComponent implements AfterViewInit, OnDestroy {
    readonly label = input.required<string>();
    /** Subtle pill next to the label. Hidden when null or <= 0. */
    readonly totalCount = input<number | null>(null);
    readonly seeAllLink = input<string[] | null>(null);
    readonly seeAllQueryParams = input<Params | null>(null);
    readonly seeAllActivated = output<MouseEvent>();
    /**
     * Already-translated label for the see-all link. Falls back to the
     * dashboard's "Manage all" translation when null, so dashboard callers
     * don't need to pass anything.
     */
    readonly seeAllLabel = input<string | null>(null);
    /** Optional active-accent decoration (e.g. the currently-scoped section). */
    readonly active = input<boolean>(false);

    private readonly track =
        viewChild.required<ElementRef<HTMLDivElement>>('track');

    readonly canScrollLeft = signal(false);
    readonly canScrollRight = signal(false);
    private resizeObserver?: ResizeObserver;
    private contentObserver?: MutationObserver;

    ngAfterViewInit(): void {
        this.updateScrollState();
        this.resizeObserver = new ResizeObserver(() =>
            this.updateScrollState()
        );
        this.contentObserver = new MutationObserver(() =>
            this.updateScrollState()
        );
        const track = this.track().nativeElement;
        this.resizeObserver.observe(track);
        this.contentObserver.observe(track, { childList: true });
    }

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.contentObserver?.disconnect();
    }

    onScroll(): void {
        this.updateScrollState();
    }

    scrollBy(direction: 1 | -1): void {
        const el = this.track().nativeElement;
        el.scrollBy({
            left: direction * el.clientWidth * 0.85,
            behavior: 'smooth',
        });
    }

    private updateScrollState(): void {
        const el = this.track().nativeElement;
        this.canScrollLeft.set(el.scrollLeft > 4);
        this.canScrollRight.set(
            el.scrollLeft + el.clientWidth < el.scrollWidth - 4
        );
    }
}

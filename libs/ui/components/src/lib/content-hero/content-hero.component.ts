import {
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    input,
    linkedSignal,
    signal,
    untracked,
    viewChild,
    ElementRef,
    ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { HeroTrailerBackdropComponent } from '../detail-ui/hero-trailer-backdrop.component';

/** `stage` keeps room for a 16:9 backdrop; `compact` is sized by the content. */
export type ContentHeroLayout = 'stage' | 'compact';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    imports: [
        HeroTrailerBackdropComponent,
        MatIconModule,
        MatButtonModule,
        MatTooltipModule,
        NgxSkeletonLoaderComponent,
        TranslateModule,
    ],
    templateUrl: './content-hero.component.html',
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./content-hero.component.scss'],
})
export class ContentHeroComponent {
    private readonly destroyRef = inject(DestroyRef);

    readonly title = input<string>();
    /** "Movie · playlist name" eyebrow above the title. */
    readonly kindLabel = input<string | null>(null);
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    /**
     * Stable identity of the shown title (provider + id). The layout is
     * decided once per identity; enrichment may replace the title itself.
     */
    readonly contentKey = input<string | null>(null);
    /** 0–100 watched share; renders the resume bar above the actions. */
    readonly progress = input<number | null>(null);
    /** With the setting on, this trailer plays muted behind the details. */
    readonly trailerBackdropUrl = input<string | null>(null);
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();

    readonly posterError = signal(false);
    private readonly failedBackdropUrl = signal<string | undefined>(undefined);
    readonly backdropSourceUrl = computed(
        () => this.backdropUrl() || this.posterUrl()
    );
    readonly backdropError = computed(() => {
        const source = this.backdropSourceUrl();
        return !!source && this.failedBackdropUrl() === source;
    });
    readonly backdropImageUrl = computed(() =>
        this.backdropError() ? undefined : this.backdropSourceUrl()
    );
    /**
     * No 16:9 backdrop, or the provider sent the poster twice: the poster,
     * blurred and scaled, becomes the backdrop (the sharp copy stays on the
     * left). Common for Xtream and Stalker portals.
     */
    readonly usesPosterBackdrop = computed(() => {
        const poster = this.posterUrl();
        const backdrop = this.backdropUrl();
        return (
            !!poster &&
            (!backdrop || backdrop === poster) &&
            !this.backdropError()
        );
    });
    private readonly hasRealBackdrop = computed(() => {
        const backdrop = this.backdropUrl();
        return !!backdrop && backdrop !== this.posterUrl();
    });
    /**
     * Decided once per title: a backdrop that TMDB enrichment adds a moment
     * later fills the compact hero instead of growing it under the user's
     * cursor. Keyed by `contentKey`, falling back to the title for hosts
     * without one.
     */
    readonly layout = linkedSignal<string | undefined, ContentHeroLayout>({
        source: () => this.contentKey() ?? this.title(),
        computation: () =>
            untracked(() => this.hasRealBackdrop()) ? 'stage' : 'compact',
    });

    readonly descriptionEl =
        viewChild<ElementRef<HTMLElement>>('descriptionEl');
    readonly isDescriptionExpanded = signal(false);
    readonly hasDescriptionOverflow = signal(false);

    private resizeObserver?: ResizeObserver;

    constructor() {
        effect(() => {
            this.posterUrl();
            untracked(() => this.posterError.set(false));
        });
        effect(() => {
            // Re-measure whenever description content or the element changes.
            this.description();
            const el = this.descriptionEl()?.nativeElement;
            if (!el) return;

            // untracked: measureOverflow reads isDescriptionExpanded();
            // tracking it would re-run this effect (and rebuild the
            // ResizeObserver) on every expand/collapse click.
            untracked(() => {
                this.measureOverflow(el);
                this.observeOverflow(el);
            });
        });

        this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    }

    onPosterError(): void {
        this.posterError.set(true);
    }

    onBackdropError(): void {
        this.failedBackdropUrl.set(this.backdropSourceUrl());
    }

    readonly formattedTitle = computed(() => {
        const t = this.title();
        if (!t) return '';
        // Replace underscores with spaces for cleaner UX on slug/filename style titles
        return t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    });

    private calculateHue(text: string): number {
        if (!text) return 0;
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = text.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash;
        }
        return Math.abs(hash) % 360;
    }

    readonly fallbackPosterBackground = computed(() => {
        const hue = this.calculateHue(this.title() || 'placeholder');
        const h2 = (hue + 40) % 360;
        return `linear-gradient(135deg, hsl(${hue}, 40%, 25%) 0%, hsl(${h2}, 50%, 15%) 100%)`;
    });

    readonly fallbackBackdropBackground = computed(() => {
        const hue = this.calculateHue(this.title() || 'placeholder');
        const h2 = (hue + 60) % 360;
        return `linear-gradient(135deg, hsl(${hue}, 50%, 15%) 0%, hsl(${h2}, 80%, 5%) 100%)`;
    });

    toggleDescription(): void {
        this.isDescriptionExpanded.update((v) => !v);
    }

    private measureOverflow(el: HTMLElement): void {
        // Measure only in the clamped state; if already expanded, clamped overflow
        // is implied when the element previously overflowed.
        if (this.isDescriptionExpanded()) return;
        this.hasDescriptionOverflow.set(el.scrollHeight > el.clientHeight + 1);
    }

    private observeOverflow(el: HTMLElement): void {
        this.resizeObserver?.disconnect();
        if (typeof ResizeObserver === 'undefined') {
            this.measureOverflow(el);
            return;
        }
        this.resizeObserver = new ResizeObserver(() =>
            this.measureOverflow(el)
        );
        this.resizeObserver.observe(el);
    }
}

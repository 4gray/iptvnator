import {
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
    ElementRef,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    imports: [
        MatIconModule,
        MatButtonModule,
        NgxSkeletonLoaderComponent,
        TranslateModule,
    ],
    templateUrl: './content-hero.component.html',
    styleUrls: ['./content-hero.component.scss'],
})
export class ContentHeroComponent {
    private readonly destroyRef = inject(DestroyRef);

    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();

    readonly backClicked = output<void>();
    readonly posterError = signal(false);

    readonly descriptionEl = viewChild<ElementRef<HTMLElement>>('descriptionEl');
    readonly isDescriptionExpanded = signal(false);
    readonly hasDescriptionOverflow = signal(false);

    private resizeObserver?: ResizeObserver;

    constructor() {
        effect(() => {
            // Re-measure whenever description content or the element changes.
            this.description();
            const el = this.descriptionEl()?.nativeElement;
            if (!el) return;

            this.measureOverflow(el);
            this.observeOverflow(el);
        });

        this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    }

    onPosterError(): void {
        this.posterError.set(true);
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

    onBack(): void {
        this.backClicked.emit();
    }

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
        this.resizeObserver = new ResizeObserver(() => this.measureOverflow(el));
        this.resizeObserver.observe(el);
    }
}

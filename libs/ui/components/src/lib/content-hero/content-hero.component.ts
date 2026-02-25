import { Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    imports: [MatIconModule, MatButtonModule, NgxSkeletonLoaderComponent],
    templateUrl: './content-hero.component.html',
    styleUrls: ['./content-hero.component.scss'],
})
export class ContentHeroComponent {
    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();

    readonly backClicked = output<void>();
    readonly posterError = signal(false);

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
}

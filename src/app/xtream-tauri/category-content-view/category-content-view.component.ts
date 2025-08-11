import { NgOptimizedImage } from '@angular/common';
import { AfterViewInit, Component, ElementRef, QueryList, ViewChildren, effect, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TvNavigationDirective } from '../../shared/directives/tv-navigation.directive';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-category-content-view',
    templateUrl: './category-content-view.component.html',
    styleUrls: ['./category-content-view.component.scss'],
    imports: [
        MatCardModule,
        MatIcon,
        MatPaginatorModule,
        MatTooltip,
        NgOptimizedImage,
        PlaylistErrorViewComponent,
        TranslatePipe,
        TvNavigationDirective,
    ],
})
export class CategoryContentViewComponent implements AfterViewInit {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly elementRef = inject(ElementRef);

    readonly limit = this.xtreamStore.limit;
    readonly pageSizeOptions = [5, 10, 25, 50, 100];
    readonly paginatedContent = this.xtreamStore.getPaginatedContent;
    readonly selectedCategory = this.xtreamStore.getSelectedCategory;
    readonly totalPages = this.xtreamStore.getTotalPages;

    @ViewChildren('contentCard') contentCards!: QueryList<ElementRef>;

    constructor() {
        // Listen for content changes to update navigation
        effect(() => {
            const content = this.paginatedContent();
            if (content && content.length > 0) {
                setTimeout(() => {
                    this.setupTvNavigation();
                }, 100);
            }
        });
    }

    ngAfterViewInit() {
        // Setup TV navigation after view is initialized
        this.setupTvNavigation();
    }

    /**
     * Setup TV navigation for content cards
     */
    private setupTvNavigation(): void {
        const cards = this.elementRef.nativeElement.querySelectorAll('mat-card');
        if (cards.length > 0) {
            // Calculate optimal grid columns based on screen size
            const optimalCols = this.calculateOptimalGridColumns();
            
            // Add tabindex to make cards focusable
            cards.forEach((card: HTMLElement, index: number) => {
                card.setAttribute('tabindex', '0');
                card.setAttribute('role', 'button');
                card.setAttribute('aria-label', `Content item ${index + 1}`);
                
                // Add keyboard event listeners for TV navigation
                card.addEventListener('keydown', (event: KeyboardEvent) => {
                    this.handleCardKeydown(event, card, index);
                });
                
                // Add click event for touch devices
                card.addEventListener('click', () => {
                    this.onItemClick(this.paginatedContent()[index]);
                });
            });
        }
    }

    /**
     * Calculate optimal grid columns based on screen size
     */
    private calculateOptimalGridColumns(): number {
        const screenWidth = window.innerWidth;
        
        if (screenWidth >= 1920) return 6; // TV
        if (screenWidth >= 1440) return 5; // Large desktop
        if (screenWidth >= 1024) return 4; // Desktop
        if (screenWidth >= 768) return 3;  // Tablet
        if (screenWidth >= 480) return 2;  // Mobile
        return 1; // Small mobile
    }

    /**
     * Handle keyboard navigation for content cards
     */
    private handleCardKeydown(event: KeyboardEvent, card: HTMLElement, index: number): void {
        const cards = this.elementRef.nativeElement.querySelectorAll('mat-card');
        const totalCards = cards.length;
        const cols = this.calculateOptimalGridColumns();
        
        switch (event.key) {
            case 'ArrowRight':
                event.preventDefault();
                if (index < totalCards - 1) {
                    (cards[index + 1] as HTMLElement).focus();
                }
                break;
            case 'ArrowLeft':
                event.preventDefault();
                if (index > 0) {
                    (cards[index - 1] as HTMLElement).focus();
                }
                break;
            case 'ArrowDown':
                event.preventDefault();
                const nextRowIndex = index + cols;
                if (nextRowIndex < totalCards) {
                    (cards[nextRowIndex] as HTMLElement).focus();
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                const prevRowIndex = index - cols;
                if (prevRowIndex >= 0) {
                    (cards[prevRowIndex] as HTMLElement).focus();
                }
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                this.onItemClick(this.paginatedContent()[index]);
                break;
            case 'Home':
                event.preventDefault();
                (cards[0] as HTMLElement).focus();
                break;
            case 'End':
                event.preventDefault();
                (cards[totalCards - 1] as HTMLElement).focus();
                break;
        }
    }

    onPageChange(event: PageEvent) {
        this.xtreamStore.setPage(event.pageIndex + 1);
        this.xtreamStore.setLimit(event.pageSize);
        localStorage.setItem('xtream-page-size', event.pageSize.toString());
        
        // Refocus first card after page change
        setTimeout(() => {
            const firstCard = this.elementRef.nativeElement.querySelector('mat-card');
            if (firstCard) {
                (firstCard as HTMLElement).focus();
            }
        }, 100);
    }

    onItemClick(item: any) {
        this.xtreamStore.setSelectedItem(item);
        this.router.navigate([item.xtream_id], {
            relativeTo: this.activatedRoute,
        });
    }

    /**
     * Get responsive page size options based on screen size
     */
    getResponsivePageSizeOptions(): number[] {
        const screenWidth = window.innerWidth;
        
        if (screenWidth >= 1920) return [10, 25, 50, 100, 200]; // TV
        if (screenWidth >= 1024) return [10, 25, 50, 100]; // Desktop
        if (screenWidth >= 768) return [5, 10, 25, 50]; // Tablet
        return [5, 10, 25]; // Mobile
    }
}

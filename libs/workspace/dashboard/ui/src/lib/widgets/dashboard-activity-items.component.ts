import { Component, EventEmitter, input, Output, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

export interface DashboardActivityItemViewModel {
    id: string;
    title: string;
    subtitle: string;
    type: 'live' | 'movie' | 'series';
    imageUrl?: string;
    link: string[];
    navigationState?: Record<string, unknown>;
}

type DashboardActivityViewMode = 'list' | 'grid';

@Component({
    selector: 'app-dashboard-activity-items',
    imports: [MatIcon, RouterLink],
    templateUrl: './dashboard-activity-items.component.html',
    styleUrl: './dashboard-activity-items.component.scss',
})
export class DashboardActivityItemsComponent {
    @Output() readonly scrolledToEnd = new EventEmitter<void>();

    readonly items = input.required<DashboardActivityItemViewModel[]>();
    readonly emptyLabel = input('No items to show.');
    readonly viewMode = input<DashboardActivityViewMode>('list');

    readonly failedImages = signal<Record<string, true>>({});

    hasImage(item: DashboardActivityItemViewModel): boolean {
        if (!item.imageUrl) {
            return false;
        }

        return !this.failedImages()[item.id];
    }

    markImageAsFailed(itemId: string): void {
        this.failedImages.update((state) => {
            if (state[itemId]) {
                return state;
            }

            return {
                ...state,
                [itemId]: true,
            };
        });
    }

    getFallbackIcon(item: DashboardActivityItemViewModel): string {
        if (item.type === 'live') {
            return 'live_tv';
        }

        if (item.type === 'series') {
            return 'movie_filter';
        }

        return 'movie';
    }

    onItemsScroll(event: Event): void {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }

        const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
        if (remaining <= 120) {
            this.scrolledToEnd.emit();
        }
    }
}

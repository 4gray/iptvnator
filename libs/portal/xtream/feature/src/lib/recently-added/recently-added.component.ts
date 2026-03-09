import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ContentType } from '@iptvnator/portal/xtream/data-access';

interface RecentlyAddedItem {
    readonly added?: string;
    readonly category_id: string | number;
    readonly cover?: string;
    readonly id?: number;
    readonly last_modified?: string;
    readonly name?: string;
    readonly poster_url?: string;
    readonly series_id?: number;
    readonly stream_id?: number;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly xtream_id?: number;
}

@Component({
    selector: 'app-recently-added',
    templateUrl: './recently-added.component.html',
    styleUrls: ['./recently-added.component.scss'],
    imports: [ContentCardComponent, TranslatePipe],
})
export class RecentlyAddedComponent {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly router = inject(Router);
    private readonly activatedRoute = inject(ActivatedRoute);

    readonly recentlyAddedLive = computed(() =>
        this.getRecentlyAdded(
            this.xtreamStore.liveStreams() as RecentlyAddedItem[]
        )
    );
    readonly recentlyAddedVod = computed(() =>
        this.getRecentlyAdded(
            this.xtreamStore.vodStreams() as RecentlyAddedItem[]
        )
    );
    readonly recentlyAddedSeries = computed(() =>
        this.getRecentlyAdded(
            this.xtreamStore.serialStreams() as RecentlyAddedItem[],
            true
        )
    );
    readonly selectedContentType = this.xtreamStore.selectedContentType;

    private getRecentlyAdded<T extends RecentlyAddedItem>(
        items: T[],
        isSeries = false
    ): T[] {
        return [...items]
            .sort((a, b) => {
                const dateA =
                    parseInt(isSeries ? a.last_modified : a.added) || 0;
                const dateB =
                    parseInt(isSeries ? b.last_modified : b.added) || 0;
                return dateB - dateA;
            })
            .slice(0, 20);
    }

    getDate(item: RecentlyAddedItem): number {
        const timestamp = item.added || item.last_modified;
        return parseInt(timestamp) * 1000;
    }

    isSectionActive(type: ContentType): boolean {
        return this.selectedContentType() === type;
    }

    openItem(item: RecentlyAddedItem, type: ContentType) {
        this.xtreamStore.setSelectedContentType(type);

        if (type === 'live') {
            this.router.navigate(['..', type, item.category_id], {
                relativeTo: this.activatedRoute,
            });
        } else {
            const itemId =
                item.xtream_id ||
                item.id ||
                (type === 'series' ? item.series_id : item.stream_id);
            this.router.navigate(['..', type, item.category_id, itemId], {
                relativeTo: this.activatedRoute,
            });
        }
    }
}

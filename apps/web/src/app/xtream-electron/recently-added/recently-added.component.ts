import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ContentCardComponent } from '../../shared/components/content-card/content-card.component';
import { XtreamStore } from '../stores/xtream.store';
import { ContentType } from '../xtream-state';

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
        this.getRecentlyAdded(this.xtreamStore.liveStreams())
    );
    readonly recentlyAddedVod = computed(() =>
        this.getRecentlyAdded(this.xtreamStore.vodStreams())
    );
    readonly recentlyAddedSeries = computed(() =>
        this.getRecentlyAdded(this.xtreamStore.serialStreams(), true)
    );
    readonly selectedContentType = this.xtreamStore.selectedContentType;

    private getRecentlyAdded(items: any[], isSeries = false) {
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

    getDate(item: any): number {
        const timestamp = item.added || item.last_modified;
        return parseInt(timestamp) * 1000;
    }

    isSectionActive(type: ContentType): boolean {
        return this.selectedContentType() === type;
    }

    openItem(item: any, type: ContentType) {
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

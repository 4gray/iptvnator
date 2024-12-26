import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-recently-viewed',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule],
    templateUrl: './recently-viewed.component.html',
    styleUrl: './recently-viewed.component.scss',
})
export class RecentlyViewedComponent {
    private xtreamStore = inject(XtreamStore);
    private activatedRoute = inject(ActivatedRoute);
    private router = inject(Router);

    readonly recentItems = this.xtreamStore.recentItems;
    readonly currentPlaylist = this.xtreamStore.currentPlaylist;

    constructor() {
        this.xtreamStore.loadRecentItems(this.currentPlaylist);
    }

    clearHistory() {
        this.xtreamStore.clearRecentItems(this.xtreamStore.currentPlaylist);
    }

    openItem(item: any) {
        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.setSelectedContentType(type);

        this.router.navigate(['..', type, item.category_id, item.xtream_id], {
            relativeTo: this.activatedRoute,
        });
    }

    removeItem(event: Event, itemId: number) {
        event.stopPropagation();
        this.xtreamStore.removeRecentItem({
            itemId,
            playlistId: this.currentPlaylist().id
        });
    }
}

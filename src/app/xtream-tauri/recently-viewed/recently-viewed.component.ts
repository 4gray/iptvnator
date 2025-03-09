import { CommonModule, KeyValuePipe } from '@angular/common';
import { Component, computed, inject, Optional } from '@angular/core';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import groupBy from 'lodash/groupBy';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-recently-viewed',
    standalone: true,
    imports: [
        CommonModule,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        KeyValuePipe,
        MatIconButton,
    ],
    templateUrl: './recently-viewed.component.html',
    styleUrl: './recently-viewed.component.scss',
})
export class RecentlyViewedComponent {
    private xtreamStore = inject(XtreamStore);
    private activatedRoute = inject(ActivatedRoute);
    private router = inject(Router);
    private dialogData = inject(MAT_DIALOG_DATA, { optional: true });

    readonly isGlobal = this.dialogData?.isGlobal ?? false;
    readonly recentItems = computed(() =>
        this.isGlobal
            ? this.xtreamStore.globalRecentItems()
            : this.xtreamStore.recentItems()
    );
    readonly currentPlaylist = this.xtreamStore.currentPlaylist;

    constructor(
        @Optional() public dialogRef?: MatDialogRef<RecentlyViewedComponent>
    ) {
        if (this.isGlobal) {
            this.loadGlobalItems();
        } else if (this.currentPlaylist()) {
            this.xtreamStore.loadRecentItems(this.currentPlaylist);
        }
    }

    private async loadGlobalItems() {
        try {
            await this.xtreamStore.loadGlobalRecentItems();
        } catch (error) {
            console.error('Error loading global items:', error);
        }
    }

    clearHistory() {
        if (this.isGlobal) {
            this.xtreamStore.clearGlobalRecentlyViewed();
        } else {
            this.xtreamStore.clearRecentItems(this.xtreamStore.currentPlaylist);
        }
    }

    openItem(item: any) {
        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.setSelectedContentType(type);

        if (this.isGlobal) {
            this.dialogRef?.close();

            this.router.navigate([
                '/xtreams',
                item.playlist_id,
                type,
                item.category_id,
                item.xtream_id,
            ]);
        } else {
            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.activatedRoute,
                }
            );
        }
    }

    removeItem(event: Event, itemId: number) {
        event.stopPropagation();
        this.xtreamStore.removeRecentItem({
            itemId,
            playlistId: this.currentPlaylist().id,
        });
    }

    getGroupedItems() {
        const items = this.recentItems();
        if (!this.isGlobal) return { default: items };
        const grouped = groupBy(items, 'playlist_name');
        return grouped;
    }
}

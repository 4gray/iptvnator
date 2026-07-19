import { ChangeDetectionStrategy } from '@angular/core';
import { Component, computed, inject, signal } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import {
    MatButtonToggle,
    MatButtonToggleGroup,
} from '@angular/material/button-toggle';
import {
    MatDialogClose,
    MatDialogContent,
    MatDialogRef,
    MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    MultiviewSlotChannel,
    MultiviewSlotOrigin,
} from './multiview-state.service';

/** Dialog result: the picked channel, or `undefined` when dismissed. */
export type MultiviewChannelPickerResult = MultiviewSlotChannel;

function isLiveTvItem(item: UnifiedCollectionItem): boolean {
    return item.contentType === 'live' && item.radio !== 'true';
}

/**
 * Channel picker for multiview slots. Offers the cross-source unified
 * favorites and recently viewed lists (live TV only, no radio) with a
 * simple text filter.
 */
@Component({
    selector: 'lib-multiview-channel-picker-dialog',
    templateUrl: './multiview-channel-picker-dialog.component.html',
    styleUrls: ['./multiview-channel-picker-dialog.component.scss'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonToggle,
        MatButtonToggleGroup,
        MatDialogClose,
        MatDialogContent,
        MatDialogTitle,
        MatIcon,
        MatIconButton,
        MatProgressSpinner,
        TranslatePipe,
    ],
})
export class MultiviewChannelPickerDialogComponent {
    private readonly dialogRef =
        inject<
            MatDialogRef<
                MultiviewChannelPickerDialogComponent,
                MultiviewChannelPickerResult
            >
        >(MatDialogRef);
    private readonly favoritesData = inject(UnifiedFavoritesDataService);
    private readonly recentData = inject(UnifiedRecentDataService);
    readonly translate = inject(TranslateService);

    readonly activeTab = signal<MultiviewSlotOrigin>('favorites');
    readonly searchTerm = signal('');
    readonly loading = signal(true);

    private readonly favorites = signal<UnifiedCollectionItem[]>([]);
    private readonly recent = signal<UnifiedCollectionItem[]>([]);

    readonly filteredItems = computed(() => {
        const items =
            this.activeTab() === 'favorites' ? this.favorites() : this.recent();
        const term = this.searchTerm().trim().toLowerCase();
        if (!term) {
            return items;
        }
        return items.filter(
            (item) =>
                item.name.toLowerCase().includes(term) ||
                item.playlistName?.toLowerCase().includes(term)
        );
    });

    constructor() {
        void this.loadItems();
    }

    onTabChange(origin: MultiviewSlotOrigin): void {
        this.activeTab.set(origin);
    }

    onSearchInput(event: Event): void {
        this.searchTerm.set((event.target as HTMLInputElement).value);
    }

    selectItem(item: UnifiedCollectionItem): void {
        this.dialogRef.close({ item, origin: this.activeTab() });
    }

    private async loadItems(): Promise<void> {
        const [favorites, recent] = await Promise.all([
            this.favoritesData.getFavorites('all').catch(() => []),
            this.recentData.getRecentItems('all').catch(() => []),
        ]);
        this.favorites.set(favorites.filter(isLiveTvItem));
        this.recent.set(recent.filter(isLiveTvItem));
        this.loading.set(false);
    }
}

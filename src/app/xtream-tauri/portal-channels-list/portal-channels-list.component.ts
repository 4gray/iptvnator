import { ScrollingModule } from '@angular/cdk/scrolling';
import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { DatabaseService } from '../../services/database.service';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-portal-channels-list',
    standalone: true,
    templateUrl: './portal-channels-list.component.html',
    styleUrls: ['./portal-channels-list.component.scss'],
    imports: [
        FilterPipe,
        FormsModule,
        MatFormFieldModule,
        ScrollingModule,
        MatCardModule,
        MatIcon,
        MatIconButton,
        MatListModule,
        MatInputModule,
        TranslateModule,
        MatTooltipModule,
    ],
})
export class PortalChannelsListComponent {
    @Output() playClicked = new EventEmitter<any>();

    readonly xtreamStore = inject(XtreamStore);
    private readonly favoritesService = inject(FavoritesService);
    private readonly dbService = inject(DatabaseService);
    private readonly route = inject(ActivatedRoute);
    readonly channels = this.xtreamStore.selectItemsFromSelectedCategory;

    favorites = new Map<number, boolean>();
    searchString = signal<string>('');

    trackBy(_index: number, item: XtreamItem) {
        return item.xtream_id;
    }

    ngOnInit(): void {
        const { categoryId } = this.route.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: any) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                    console.log(this.favorites);
                });
        }
    }

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.xtreamStore.selectedCategoryId();
        const itemId = Number((item as any).category_id || item.id);
        return selectedCategory !== null && selectedCategory === itemId;
    }

    async toggleFavorite(event: Event, item: any): Promise<void> {
        event.stopPropagation();
        const playlist = this.xtreamStore.currentPlaylist();

        // Update UI state immediately
        const currentFavoriteState =
            this.favorites.get(item.xtream_id) || false;
        this.favorites.set(item.xtream_id, !currentFavoriteState);

        try {
            const db = await this.dbService.getConnection();
            const content: any = await db.select(
                'SELECT id FROM content WHERE xtream_id = ?',
                [item.xtream_id]
            );

            if (!content || content.length === 0) {
                console.error('Content not found in database');
                // Revert UI state on error
                this.favorites.set(item.xtream_id, currentFavoriteState);
                return;
            }

            const contentId = content[0].id;

            if (!currentFavoriteState) {
                await this.favoritesService.addToFavorites({
                    content_id: contentId,
                    playlist_id: playlist.id,
                });
            } else {
                await this.favoritesService.removeFromFavorites(
                    contentId,
                    playlist.id
                );
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            // Revert UI state on error
            this.favorites.set(item.xtream_id, currentFavoriteState);
        }
    }
}

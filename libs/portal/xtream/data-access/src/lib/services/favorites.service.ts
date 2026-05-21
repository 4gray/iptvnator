import { inject, Injectable } from '@angular/core';
import { from, map, Observable } from 'rxjs';
import { XTREAM_DATA_SOURCE } from '../data-sources/xtream-data-source.interface';
import { FavoriteItem } from './favorite-item.interface';

function normalizeCategoryId(categoryId: string | number): number {
    const numericCategoryId = Number(categoryId);
    return Number.isFinite(numericCategoryId) ? numericCategoryId : 0;
}

@Injectable({
    providedIn: 'root',
})
export class FavoritesService {
    private dataSource = inject(XTREAM_DATA_SOURCE);

    async addToFavorites(item: {
        content_id: number;
        playlist_id: string;
        backdrop_url?: string;
    }): Promise<void> {
        await this.dataSource.addFavorite(
            item.content_id,
            item.playlist_id,
            item.backdrop_url
        );
    }

    async removeFromFavorites(
        contentId: number,
        playlistId: string
    ): Promise<void> {
        await this.dataSource.removeFavorite(contentId, playlistId);
    }

    async isFavorite(contentId: number, playlistId: string): Promise<boolean> {
        return await this.dataSource.isFavorite(contentId, playlistId);
    }

    getFavorites(playlistId: string): Observable<FavoriteItem[]> {
        return from(this.dataSource.getFavorites(playlistId)).pipe(
            map((items) =>
                items.map((item) => ({
                    content_id: item.id,
                    playlist_id: playlistId,
                    type: item.type as FavoriteItem['type'],
                    title: item.title,
                    poster_url: item.poster_url,
                    added_at: item.added_at,
                    category_id: normalizeCategoryId(item.category_id),
                    xtream_id: item.xtream_id,
                }))
            )
        );
    }
}

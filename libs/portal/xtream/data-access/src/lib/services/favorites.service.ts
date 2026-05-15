import { inject, Injectable } from '@angular/core';
import { from, map, Observable } from 'rxjs';
import { DatabaseService } from '@iptvnator/services';
import { FavoriteItem } from './favorite-item.interface';

@Injectable({
    providedIn: 'root',
})
export class FavoritesService {
    private dbService = inject(DatabaseService);

    async addToFavorites(item: {
        content_id: number;
        playlist_id: string;
        backdrop_url?: string;
    }): Promise<void> {
        await this.dbService.addToFavorites(
            item.content_id,
            item.playlist_id,
            item.backdrop_url
        );
    }

    async removeFromFavorites(
        contentId: number,
        playlistId: string
    ): Promise<void> {
        await this.dbService.removeFromFavorites(contentId, playlistId);
    }

    async isFavorite(contentId: number, playlistId: string): Promise<boolean> {
        return await this.dbService.isFavorite(contentId, playlistId);
    }

    getFavorites(playlistId: string): Observable<FavoriteItem[]> {
        return from(this.dbService.getFavorites(playlistId)).pipe(
            map((items) =>
                items.map((item) => ({
                    content_id: item.id,
                    playlist_id: playlistId,
                    type: item.type as FavoriteItem['type'],
                    title: item.title,
                    poster_url: item.poster_url,
                    added_at: item.added_at,
                    category_id: item.category_id,
                    xtream_id: item.xtream_id,
                }))
            )
        );
    }
}

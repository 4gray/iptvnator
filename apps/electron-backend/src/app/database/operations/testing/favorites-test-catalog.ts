import type { AppDatabase } from '../../database.types';
import * as schema from '@iptvnator/shared/database/schema';

export function createFavoriteTestCatalog(db: AppDatabase) {
    return async function catalog(
        id: number,
        xtreamId: number,
        title = 'ABC',
        type: 'movie' | 'live' | 'series' = 'movie',
        playlistId = 'p',
        metadata = {}
    ) {
        await db.insert(schema.categories).values({
            id,
            playlistId,
            name: 'Category',
            type: type === 'movie' ? 'movies' : type,
            xtreamId: id,
        });
        await db.insert(schema.content).values({
            id,
            categoryId: id,
            title,
            xtreamId,
            type,
            posterUrl: 'https://art.invalid/poster.jpg',
            backdropUrl: 'https://art.invalid/backdrop.jpg',
            ...metadata,
        });
    };
}

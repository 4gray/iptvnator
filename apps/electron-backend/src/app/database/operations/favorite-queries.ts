import { and, asc, desc, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { unlockedCategoryCondition } from '../parental-lock-state';
import {
    favoriteCatalogStatus,
    favoriteImportStateKey,
    resolvedFavoriteContentId,
} from './favorite-catalog';

/** Nullable catalog joins preserve the saved title and artwork when an item disappears. */
export function selectFavoriteRows(
    db: AppDatabase,
    playlistId?: string,
    includeLocked = false
) {
    return (
        db
            .select({
                favorite_id: schema.favorites.id,
                id: schema.content.id,
                category_id: schema.content.categoryId,
                title: sql<string>`COALESCE(NULLIF(TRIM(${schema.content.title}), ''), ${schema.favorites.title})`,
                rating: schema.content.rating,
                added: schema.content.added,
                poster_url: sql<
                    string | null
                >`COALESCE(NULLIF(TRIM(${schema.content.posterUrl}), ''), ${schema.favorites.posterUrl})`,
                backdrop_url: sql<
                    string | null
                >`COALESCE(NULLIF(TRIM(${schema.content.backdropUrl}), ''), ${schema.favorites.backdropUrl})`,
                tmdb_id: sql<
                    number | null
                >`COALESCE(${schema.content.tmdbId}, ${schema.favorites.tmdbId})`,
                release_year: sql<
                    number | null
                >`COALESCE(${schema.content.releaseYear}, ${schema.favorites.releaseYear})`,
                original_title: sql<
                    string | null
                >`COALESCE(NULLIF(TRIM(${schema.content.originalTitle}), ''), ${schema.favorites.originalTitle})`,
                xtream_id: schema.favorites.xtreamId,
                type: schema.favorites.type,
                tv_archive: schema.content.tvArchive,
                tv_archive_duration: schema.content.tvArchiveDuration,
                playlist_id: schema.playlists.id,
                playlist_name: schema.playlists.name,
                added_at: schema.favorites.addedAt,
                position: schema.favorites.position,
                catalog_status: favoriteCatalogStatus(),
            })
            .from(schema.favorites)
            .leftJoin(
                schema.content,
                eq(schema.content.id, resolvedFavoriteContentId())
            )
            .leftJoin(
                schema.categories,
                eq(schema.categories.id, schema.content.categoryId)
            )
            .innerJoin(
                schema.playlists,
                eq(schema.playlists.id, schema.favorites.playlistId)
            )
            .leftJoin(
                schema.appState,
                eq(schema.appState.key, favoriteImportStateKey())
            )
            // While locked, unresolved category ownership must fail closed too.
            .where(
                and(
                    playlistId === undefined
                        ? undefined
                        : eq(schema.favorites.playlistId, playlistId),
                    includeLocked ? undefined : unlockedCategoryCondition()
                )
            )
            .orderBy(
                asc(schema.favorites.position),
                desc(schema.favorites.addedAt)
            )
    );
}

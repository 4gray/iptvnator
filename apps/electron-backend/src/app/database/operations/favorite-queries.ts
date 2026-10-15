import { and, asc, desc, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { unlockedCategoryCondition } from '../parental-lock-state';
import {
    favoriteCatalogStatus,
    favoriteSnapshotMatchesContent,
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
                title: sql<string>`CASE WHEN ${favoriteSnapshotMatchesContent()} THEN COALESCE(NULLIF(TRIM(${schema.content.title}), ''), ${schema.favorites.title}) ELSE ${schema.favorites.title} END`,
                rating: schema.content.rating,
                added: schema.content.added,
                poster_url: sql<
                    string | null
                >`CASE WHEN ${favoriteSnapshotMatchesContent()} THEN COALESCE(NULLIF(TRIM(${schema.content.posterUrl}), ''), ${schema.favorites.posterUrl}) ELSE ${schema.favorites.posterUrl} END`,
                backdrop_url: sql<
                    string | null
                >`CASE WHEN ${favoriteSnapshotMatchesContent()} THEN COALESCE(NULLIF(TRIM(${schema.content.backdropUrl}), ''), ${schema.favorites.backdropUrl}) ELSE ${schema.favorites.backdropUrl} END`,
                tmdb_id: sql<
                    number | null
                >`CASE WHEN ${favoriteSnapshotMatchesContent()} THEN COALESCE(${schema.content.tmdbId}, ${schema.favorites.tmdbId}) ELSE ${schema.favorites.tmdbId} END`,
                release_year: sql<
                    number | null
                >`CASE WHEN ${favoriteSnapshotMatchesContent()} THEN COALESCE(${schema.content.releaseYear}, ${schema.favorites.releaseYear}) ELSE ${schema.favorites.releaseYear} END`,
                original_title: sql<
                    string | null
                >`CASE WHEN ${favoriteSnapshotMatchesContent()} THEN COALESCE(NULLIF(TRIM(${schema.content.originalTitle}), ''), ${schema.favorites.originalTitle}) ELSE ${schema.favorites.originalTitle} END`,
                xtream_id: schema.favorites.xtreamId,
                type: schema.favorites.type,
                tv_archive: schema.content.tvArchive,
                tv_archive_duration: schema.content.tvArchiveDuration,
                playlist_id: schema.playlists.id,
                playlist_name: schema.playlists.name,
                added_at: schema.favorites.addedAt,
                position: schema.favorites.position,
                catalog_status: favoriteCatalogStatus(),
                catalog_missing_reason: sql<
                    'identity_conflict' | null
                >`CASE WHEN ${schema.favorites.identityConflict} = 1 AND ${schema.content.id} IS NULL THEN 'identity_conflict' ELSE NULL END`,
            })
            .from(schema.favorites)
            .leftJoin(
                schema.content,
                eq(schema.content.id, resolvedFavoriteContentId(includeLocked))
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

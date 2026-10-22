import { and, eq, sql, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { isParentalLockActive } from '../parental-lock-state';

/** A covering provider-id lookup per favorite, never a scan of the catalog. */
export function resolvedFavoriteContentId(includeLocked: boolean) {
    return sql<number | null>`(SELECT candidate.id FROM content candidate
        INNER JOIN categories owner ON owner.id = candidate.category_id
        WHERE candidate.xtream_id = ${schema.favorites.xtreamId}
          AND candidate.type = ${schema.favorites.type}
          AND owner.playlist_id = ${schema.favorites.playlistId}
          ${!includeLocked && isParentalLockActive() ? sql`AND owner.locked = 0` : sql``}
          AND (${schema.favorites.identityConflict} = 0 OR (
            (${schema.favorites.tmdbId} IS NULL OR ${schema.favorites.tmdbId} = candidate.tmdb_id)
            AND (${schema.favorites.releaseYear} IS NULL OR ${schema.favorites.releaseYear} = candidate.release_year)))
          AND (
            (${schema.favorites.tmdbId} IS NULL OR candidate.tmdb_id IS NULL
                OR ${schema.favorites.tmdbId} = candidate.tmdb_id)
            AND (${schema.favorites.releaseYear} IS NULL OR candidate.release_year IS NULL
                OR ${schema.favorites.releaseYear} = candidate.release_year))
        ORDER BY (
            (${schema.favorites.tmdbId} IS NULL OR ${schema.favorites.tmdbId} = candidate.tmdb_id)
            AND (${schema.favorites.releaseYear} IS NULL OR ${schema.favorites.releaseYear} = candidate.release_year)
        ) DESC, candidate.id LIMIT 1)`;
}

/** Missing candidate metadata cannot authorize replacing an already known snapshot. */
export function favoriteSnapshotMatchesContent() {
    return sql`(${schema.favorites.tmdbId} IS NULL OR ${schema.favorites.tmdbId} = ${schema.content.tmdbId})
        AND (${schema.favorites.releaseYear} IS NULL OR ${schema.favorites.releaseYear} = ${schema.content.releaseYear})`;
}

/** Use only after confirming identity; empty catalog fields retain the saved value. */
export function favoriteSnapshotFromContent(contentId: number | SQL) {
    return {
        title: sql`COALESCE((SELECT NULLIF(TRIM(title), '') FROM content WHERE id = ${contentId}), favorites.title)`,
        posterUrl: sql`COALESCE((SELECT NULLIF(TRIM(poster_url), '') FROM content WHERE id = ${contentId}), favorites.poster_url)`,
        backdropUrl: sql`COALESCE((SELECT NULLIF(TRIM(backdrop_url), '') FROM content WHERE id = ${contentId}), favorites.backdrop_url)`,
        tmdbId: sql`COALESCE((SELECT tmdb_id FROM content WHERE id = ${contentId}), favorites.tmdb_id)`,
        releaseYear: sql`COALESCE((SELECT release_year FROM content WHERE id = ${contentId}), favorites.release_year)`,
        originalTitle: sql`COALESCE((SELECT NULLIF(TRIM(original_title), '') FROM content WHERE id = ${contentId}), favorites.original_title)`,
    };
}

export function favoriteCatalogStatus() {
    return sql<'present' | 'missing' | 'unknown'>`CASE
        WHEN ${schema.appState.value} IN ('importing', 'failed', 'cancelled') THEN 'unknown'
        WHEN ${schema.content.id} IS NOT NULL THEN 'present'
        WHEN ${schema.appState.value} = 'completed' THEN 'missing'
        ELSE 'unknown' END`;
}

export function favoriteImportStateKey() {
    return sql`'xtream-import-status:' || ${schema.favorites.playlistId} || ':' || ${schema.favorites.type}`;
}

export async function findFavoriteContent(
    db: AppDatabase,
    playlistId: string,
    identity:
        | { contentId: number }
        | { xtreamId: number; type: 'live' | 'movie' | 'series' }
) {
    const rows = await db
        .select({ content: schema.content })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                'contentId' in identity
                    ? eq(schema.content.id, identity.contentId)
                    : and(
                          eq(schema.content.xtreamId, identity.xtreamId),
                          eq(schema.content.type, identity.type)
                      )
            )
        )
        .orderBy(schema.content.id)
        .limit(1);
    return rows[0]?.content;
}

/** The import lifecycle already persists these keys; completion relinks cache pointers. */
export async function reconcileCompletedFavoriteCatalog(
    db: AppDatabase,
    key: string,
    value: string
) {
    if (value !== 'completed') return;
    const match = /^xtream-import-status:(.+):(live|movie|series)$/.exec(key);
    if (!match) return;
    db.transaction((tx) => {
        reconcileFavoriteIdentity(
            tx,
            and(
                eq(schema.favorites.playlistId, match[1]),
                eq(
                    schema.favorites.type,
                    match[2] as 'live' | 'movie' | 'series'
                )
            )
        );
        tx.update(schema.favorites)
            .set({ contentId: resolvedFavoriteContentId(true) })
            .where(
                and(
                    eq(schema.favorites.playlistId, match[1]),
                    eq(
                        schema.favorites.type,
                        match[2] as 'live' | 'movie' | 'series'
                    )
                )
            )
            .run();
        tx.update(schema.favorites)
            .set(favoriteSnapshotFromContent(sql`favorites.content_id`))
            .where(
                and(
                    sql`EXISTS (SELECT 1 FROM content WHERE id = favorites.content_id AND ${favoriteSnapshotMatchesContent()})`,
                    eq(schema.favorites.playlistId, match[1]),
                    eq(
                        schema.favorites.type,
                        match[2] as 'live' | 'movie' | 'series'
                    )
                )
            )
            .run();
    });
}

/** Every duplicate category row represents the same typed provider identity. */
export function favoriteMatchesContentId(
    contentId: number | ReturnType<typeof sql.placeholder>,
    checkIdentity = true
) {
    return sql`EXISTS (SELECT 1 FROM content candidate
        INNER JOIN categories owner ON owner.id = candidate.category_id
        WHERE candidate.id = ${contentId}
          AND owner.playlist_id = ${schema.favorites.playlistId}
          AND candidate.type = ${schema.favorites.type}
          AND candidate.xtream_id = ${schema.favorites.xtreamId}
          ${
              checkIdentity
                  ? sql`AND (${schema.favorites.identityConflict} = 0 OR (
              (${schema.favorites.tmdbId} IS NULL OR ${schema.favorites.tmdbId} = candidate.tmdb_id)
              AND (${schema.favorites.releaseYear} IS NULL OR ${schema.favorites.releaseYear} = candidate.release_year)))
          AND (${schema.favorites.tmdbId} IS NULL OR candidate.tmdb_id IS NULL OR ${schema.favorites.tmdbId} = candidate.tmdb_id)
          AND (${schema.favorites.releaseYear} IS NULL OR candidate.release_year IS NULL OR ${schema.favorites.releaseYear} = candidate.release_year)`
                  : sql``
          })`;
}

/** Full confirmation outranks conflicting duplicates; absence/partial evidence retains the latch. */
export function reconcileFavoriteIdentity(db: AppDatabase, scope?: SQL) {
    const candidate = (
        evidence: SQL
    ) => sql`EXISTS (SELECT 1 FROM content candidate
        INNER JOIN categories owner ON owner.id = candidate.category_id
        WHERE candidate.xtream_id = ${schema.favorites.xtreamId}
          AND candidate.type = ${schema.favorites.type}
          AND owner.playlist_id = ${schema.favorites.playlistId} AND (${evidence}))`;
    const confirmed =
        candidate(sql`(${schema.favorites.tmdbId} IS NULL OR ${schema.favorites.tmdbId} = candidate.tmdb_id)
        AND (${schema.favorites.releaseYear} IS NULL OR ${schema.favorites.releaseYear} = candidate.release_year)`);
    const conflicting =
        candidate(sql`(${schema.favorites.tmdbId} IS NOT NULL AND candidate.tmdb_id IS NOT NULL AND ${schema.favorites.tmdbId} != candidate.tmdb_id)
        OR (${schema.favorites.releaseYear} IS NOT NULL AND candidate.release_year IS NOT NULL AND ${schema.favorites.releaseYear} != candidate.release_year)`);
    db.update(schema.favorites)
        .set({
            identityConflict: sql`CASE
        WHEN ${confirmed} THEN 0 WHEN ${conflicting} THEN 1 ELSE ${schema.favorites.identityConflict} END`,
        })
        .where(scope)
        .run();
}

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { persistContentMetadataIfMissing } from './content-metadata.operations';
import {
    clearRecoveredHistory,
    recordRecoveredHistory,
    removeRecoveredHistory,
} from './xtream-history-recovery';

export async function getRecentlyViewed(db: AppDatabase) {
    return db
        .select({
            id: schema.content.id,
            category_id: schema.content.categoryId,
            title: schema.content.title,
            rating: schema.content.rating,
            added: schema.content.added,
            poster_url: schema.content.posterUrl,
            backdrop_url: schema.content.backdropUrl,
            tmdb_id: schema.content.tmdbId,
            release_year: schema.content.releaseYear,
            original_title: schema.content.originalTitle,
            xtream_id: schema.content.xtreamId,
            type: schema.content.type,
            tv_archive: schema.content.tvArchive,
            tv_archive_duration: schema.content.tvArchiveDuration,
            playlist_id: schema.categories.playlistId,
            playlist_name: schema.playlists.name,
            viewed_at: schema.recentlyViewed.viewedAt,
        })
        .from(schema.recentlyViewed)
        .innerJoin(
            schema.content,
            eq(schema.recentlyViewed.contentId, schema.content.id)
        )
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .innerJoin(
            schema.playlists,
            eq(schema.categories.playlistId, schema.playlists.id)
        )
        .orderBy(desc(schema.recentlyViewed.viewedAt))
        .limit(100);
}

export async function clearRecentlyViewed(
    db: AppDatabase
): Promise<{ success: boolean }> {
    db.transaction((tx) => {
        tx.delete(schema.recentlyViewed).run();
        clearRecoveredHistory(tx);
    });
    return { success: true };
}

export async function getRecentItems(
    db: AppDatabase,
    playlistId: string,
    all = false
) {
    const query = db
        .select({
            id: schema.content.id,
            category_id: schema.content.categoryId,
            title: schema.content.title,
            rating: schema.content.rating,
            added: schema.content.added,
            poster_url: schema.content.posterUrl,
            backdrop_url: schema.content.backdropUrl,
            tmdb_id: schema.content.tmdbId,
            release_year: schema.content.releaseYear,
            original_title: schema.content.originalTitle,
            xtream_id: schema.content.xtreamId,
            type: schema.content.type,
            tv_archive: schema.content.tvArchive,
            tv_archive_duration: schema.content.tvArchiveDuration,
            viewed_at: schema.recentlyViewed.viewedAt,
        })
        .from(schema.recentlyViewed)
        .innerJoin(
            schema.content,
            eq(schema.recentlyViewed.contentId, schema.content.id)
        )
        .where(eq(schema.recentlyViewed.playlistId, playlistId))
        .orderBy(desc(schema.recentlyViewed.viewedAt));
    // Recovery must retain every entry; the ordinary browsing read stays capped.
    return all ? query : query.limit(100);
}

export async function addRecentItem(
    db: AppDatabase,
    contentId: number,
    playlistId: string,
    options?: { backdropUrl?: string }
): Promise<{ success: boolean }> {
    db.transaction((tx) => {
        const existing = tx
            .select()
            .from(schema.recentlyViewed)
            .where(
                and(
                    eq(schema.recentlyViewed.contentId, contentId),
                    eq(schema.recentlyViewed.playlistId, playlistId)
                )
            )
            .limit(1)
            .all();

        if (existing.length > 0) {
            tx.update(schema.recentlyViewed)
                .set({ viewedAt: sql`CURRENT_TIMESTAMP` })
                .where(
                    and(
                        eq(schema.recentlyViewed.contentId, contentId),
                        eq(schema.recentlyViewed.playlistId, playlistId)
                    )
                )
                .run();
        } else {
            tx.insert(schema.recentlyViewed)
                .values({
                    contentId,
                    playlistId,
                })
                .run();
        }
        recordRecoveredHistory(tx, playlistId, contentId);
    });

    await persistContentMetadataIfMissing(db, contentId, {
        backdropUrl: options?.backdropUrl,
    });

    return { success: true };
}

export async function clearPlaylistRecentItems(
    db: AppDatabase,
    playlistId: string
): Promise<{ success: boolean }> {
    db.transaction((tx) => {
        const contentIds = tx
            .select({ id: schema.content.id })
            .from(schema.content)
            .innerJoin(
                schema.categories,
                eq(schema.content.categoryId, schema.categories.id)
            )
            .where(eq(schema.categories.playlistId, playlistId));

        // Keep the source scope in SQL: large catalogs exceed SQLite's bind
        // limit when their content ids are materialized into an IN list.
        tx.delete(schema.recentlyViewed)
            .where(inArray(schema.recentlyViewed.contentId, contentIds))
            .run();
        clearRecoveredHistory(tx, playlistId);
    });

    return { success: true };
}

export async function removeRecentItem(
    db: AppDatabase,
    contentId: number,
    playlistId: string
): Promise<{ success: boolean }> {
    db.transaction((tx) => {
        removeRecoveredHistory(tx, [{ contentId, playlistId }]);
        tx.delete(schema.recentlyViewed)
            .where(
                and(
                    eq(schema.recentlyViewed.contentId, contentId),
                    eq(schema.recentlyViewed.playlistId, playlistId)
                )
            )
            .run();
    });

    return { success: true };
}

export async function removeRecentItemsBatch(
    db: AppDatabase,
    items: { contentId: number; playlistId: string }[]
): Promise<{ success: boolean; count: number }> {
    if (!Array.isArray(items) || items.length === 0) {
        return { success: true, count: 0 };
    }

    const stmt = db
        .delete(schema.recentlyViewed)
        .where(
            and(
                eq(
                    schema.recentlyViewed.contentId,
                    sql.placeholder('contentId')
                ),
                eq(
                    schema.recentlyViewed.playlistId,
                    sql.placeholder('playlistId')
                )
            )
        )
        .prepare();

    await db.transaction((tx) => {
        removeRecoveredHistory(tx, items);
        for (const { contentId, playlistId } of items) {
            // .run() (synchronous), NOT .execute(): the better-sqlite3
            // driver's .execute() defers the write to a resolved promise
            // that never settles inside this synchronous transaction
            // callback, so the DELETE would silently do nothing. See the
            // matching note in favorites.operations.ts (issue #1137).
            stmt.run({ contentId, playlistId });
        }
    });

    return { success: true, count: items.length };
}

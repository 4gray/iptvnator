import { and, desc, eq, inArray, sql, type Placeholder } from 'drizzle-orm';
import { RECENTLY_VIEWED_CHRONOLOGY } from '@iptvnator/shared/database';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { persistContentMetadataIfMissing } from './content-metadata.operations';
import {
    clearRecoveredHistory,
    recordRecoveredHistory,
    removeRecoveredHistory,
} from './xtream-history-recovery';

const viewedAtChronology = () => sql.raw(RECENTLY_VIEWED_CHRONOLOGY);

function historyScope(
    contentId: number | Placeholder,
    playlistId: string | Placeholder
) {
    // Live history has one provider identity per source, even when the
    // provider lists that channel in several local category rows.
    const copies = sql`(
        SELECT ${contentId}
        UNION ALL
        SELECT copy.id
        FROM content AS target
        JOIN categories AS target_category ON target_category.id = target.category_id
        JOIN content AS copy ON copy.xtream_id = target.xtream_id AND copy.type = 'live'
        JOIN categories AS copy_category ON copy_category.id = copy.category_id
        WHERE target.id = ${contentId} AND target.type = 'live'
            AND target_category.playlist_id = ${playlistId}
            AND copy_category.playlist_id = target_category.playlist_id
            AND copy.id <> target.id
    )`;
    return and(
        eq(schema.recentlyViewed.playlistId, playlistId),
        inArray(schema.recentlyViewed.contentId, copies)
    );
}

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
        .orderBy(desc(viewedAtChronology()))
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
        .orderBy(desc(viewedAtChronology()));
    // Recovery must retain every entry; the ordinary browsing read stays capped.
    return all ? query : query.limit(100);
}

export async function addRecentItem(
    db: AppDatabase,
    contentId: number,
    playlistId: string,
    options?: { backdropUrl?: string; viewedAt?: string }
): Promise<{ success: boolean }> {
    const confirmation =
        typeof options?.viewedAt === 'string'
            ? new Date(options.viewedAt)
            : null;
    const viewedAt =
        confirmation && Number.isFinite(confirmation.getTime())
            ? confirmation.toISOString()
            : undefined;
    db.transaction((tx) => {
        const scope = historyScope(contentId, playlistId);
        const existing = tx
            .select({
                id: schema.recentlyViewed.id,
                contentId: schema.recentlyViewed.contentId,
                newer: viewedAt
                    ? sql<number>`(${viewedAtChronology()}) > julianday(${viewedAt})`
                    : sql<number>`0`,
            })
            .from(schema.recentlyViewed)
            .where(scope)
            .orderBy(desc(viewedAtChronology()))
            .all();
        const current = existing[0];
        if (existing.length > 1)
            tx.delete(schema.recentlyViewed)
                .where(
                    and(
                        scope,
                        sql`${schema.recentlyViewed.id} <> ${current.id}`
                    )
                )
                .run();
        if (!current) {
            tx.insert(schema.recentlyViewed)
                .values({
                    contentId,
                    playlistId,
                    ...(viewedAt ? { viewedAt } : {}),
                })
                .run();
        } else if (!current.newer) {
            tx.update(schema.recentlyViewed)
                .set({
                    ...(current.contentId === contentId ? {} : { contentId }),
                    viewedAt: viewedAt ?? sql`CURRENT_TIMESTAMP`,
                })
                .where(eq(schema.recentlyViewed.id, current.id))
                .run();
        }
        recordRecoveredHistory(
            tx,
            playlistId,
            current?.newer ? current.contentId : contentId
        );
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
            .where(historyScope(contentId, playlistId))
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
            historyScope(
                sql.placeholder('contentId'),
                sql.placeholder('playlistId')
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

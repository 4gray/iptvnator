import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { persistContentBackdropIfMissing } from './content-backdrop.operations';

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
            xtream_id: schema.content.xtreamId,
            type: schema.content.type,
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
    await db.delete(schema.recentlyViewed);
    return { success: true };
}

export async function getRecentItems(
    db: AppDatabase,
    playlistId: string
) {
    return db
        .select({
            id: schema.content.id,
            category_id: schema.content.categoryId,
            title: schema.content.title,
            rating: schema.content.rating,
            added: schema.content.added,
            poster_url: schema.content.posterUrl,
            backdrop_url: schema.content.backdropUrl,
            xtream_id: schema.content.xtreamId,
            type: schema.content.type,
            viewed_at: schema.recentlyViewed.viewedAt,
        })
        .from(schema.recentlyViewed)
        .innerJoin(
            schema.content,
            eq(schema.recentlyViewed.contentId, schema.content.id)
        )
        .where(eq(schema.recentlyViewed.playlistId, playlistId))
        .orderBy(desc(schema.recentlyViewed.viewedAt))
        .limit(100);
}

export async function addRecentItem(
    db: AppDatabase,
    contentId: number,
    playlistId: string,
    options?: { backdropUrl?: string }
): Promise<{ success: boolean }> {
    const existing = await db
        .select()
        .from(schema.recentlyViewed)
        .where(
            and(
                eq(schema.recentlyViewed.contentId, contentId),
                eq(schema.recentlyViewed.playlistId, playlistId)
            )
        )
        .limit(1);

    if (existing.length > 0) {
        await db
            .update(schema.recentlyViewed)
            .set({ viewedAt: sql`CURRENT_TIMESTAMP` })
            .where(
                and(
                    eq(schema.recentlyViewed.contentId, contentId),
                    eq(schema.recentlyViewed.playlistId, playlistId)
                )
            );
    } else {
        await db.insert(schema.recentlyViewed).values({
            contentId,
            playlistId,
        });
    }

    await persistContentBackdropIfMissing(db, contentId, options?.backdropUrl);

    return { success: true };
}

export async function clearPlaylistRecentItems(
    db: AppDatabase,
    playlistId: string
): Promise<{ success: boolean }> {
    const contentIds = await db
        .select({ id: schema.content.id })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(eq(schema.categories.playlistId, playlistId));

    if (contentIds.length > 0) {
        await db.delete(schema.recentlyViewed).where(
            inArray(
                schema.recentlyViewed.contentId,
                contentIds.map((content) => content.id)
            )
        );
    }

    return { success: true };
}

export async function removeRecentItem(
    db: AppDatabase,
    contentId: number,
    playlistId: string
): Promise<{ success: boolean }> {
    await db
        .delete(schema.recentlyViewed)
        .where(
            and(
                eq(schema.recentlyViewed.contentId, contentId),
                eq(schema.recentlyViewed.playlistId, playlistId)
            )
        );

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

    await db.transaction(() => {
        for (const { contentId, playlistId } of items) {
            stmt.execute({ contentId, playlistId });
        }
    });

    return { success: true, count: items.length };
}

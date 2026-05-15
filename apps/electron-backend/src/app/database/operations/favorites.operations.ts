import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    chunkValues,
    checkpointOperation,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';
import { persistContentBackdropIfMissing } from './content-backdrop.operations';

const DEFAULT_BATCH_SIZE = 100;

export async function addFavorite(
    db: AppDatabase,
    contentId: number,
    playlistId: string,
    options?: { backdropUrl?: string }
): Promise<{ success: boolean }> {
    await db.insert(schema.favorites).values({
        contentId,
        playlistId,
    });

    await persistContentBackdropIfMissing(db, contentId, options?.backdropUrl);

    return { success: true };
}

export async function removeFavorite(
    db: AppDatabase,
    contentId: number,
    playlistId: string
): Promise<{ success: boolean }> {
    await db
        .delete(schema.favorites)
        .where(
            and(
                eq(schema.favorites.contentId, contentId),
                eq(schema.favorites.playlistId, playlistId)
            )
        );

    return { success: true };
}

export async function isFavorite(
    db: AppDatabase,
    contentId: number,
    playlistId: string
): Promise<boolean> {
    const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.favorites)
        .where(
            and(
                eq(schema.favorites.contentId, contentId),
                eq(schema.favorites.playlistId, playlistId)
            )
        );

    return result[0].count > 0;
}

export async function getFavorites(db: AppDatabase, playlistId: string) {
    return db
        .select({
            id: schema.content.id,
            category_id: schema.content.categoryId,
            title: schema.content.title,
            rating: schema.content.rating,
            added: schema.content.added,
            poster_url: schema.content.posterUrl,
            xtream_id: schema.content.xtreamId,
            type: schema.content.type,
            added_at: schema.favorites.addedAt,
            position: schema.favorites.position,
        })
        .from(schema.favorites)
        .innerJoin(
            schema.content,
            eq(schema.favorites.contentId, schema.content.id)
        )
        .where(eq(schema.favorites.playlistId, playlistId))
        .orderBy(
            asc(schema.favorites.position),
            desc(schema.favorites.addedAt)
        );
}

export async function getGlobalFavorites(db: AppDatabase) {
    return db
        .select({
            id: schema.content.id,
            category_id: schema.content.categoryId,
            title: schema.content.title,
            rating: schema.content.rating,
            added: schema.content.added,
            poster_url: schema.content.posterUrl,
            xtream_id: schema.content.xtreamId,
            type: schema.content.type,
            playlist_id: schema.playlists.id,
            playlist_name: schema.playlists.name,
            added_at: schema.favorites.addedAt,
            position: schema.favorites.position,
        })
        .from(schema.favorites)
        .innerJoin(
            schema.content,
            eq(schema.favorites.contentId, schema.content.id)
        )
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .innerJoin(
            schema.playlists,
            eq(schema.categories.playlistId, schema.playlists.id)
        )
        .where(eq(schema.content.type, 'live'))
        .orderBy(asc(schema.favorites.position), desc(schema.favorites.addedAt))
        .limit(300);
}

export async function getAllGlobalFavorites(db: AppDatabase) {
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
            playlist_id: schema.playlists.id,
            playlist_name: schema.playlists.name,
            added_at: schema.favorites.addedAt,
            position: schema.favorites.position,
        })
        .from(schema.favorites)
        .innerJoin(
            schema.content,
            eq(schema.favorites.contentId, schema.content.id)
        )
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .innerJoin(
            schema.playlists,
            eq(schema.categories.playlistId, schema.playlists.id)
        )
        .orderBy(asc(schema.favorites.position), desc(schema.favorites.addedAt))
        .limit(500);
}

export async function reorderGlobalFavorites(
    db: AppDatabase,
    updates: { content_id: number; position: number }[],
    control?: OperationControl
): Promise<{ success: boolean }> {
    if (!Array.isArray(updates) || updates.length === 0) {
        return { success: true };
    }

    let current = 0;
    const total = updates.length;

    // Drizzle's .set() doesn't accept a bare Placeholder — wrap it in an
    // sql template so the value resolves to SQL<number> at compile time.
    const updateFavoritePosition = db
        .update(schema.favorites)
        .set({ position: sql<number>`${sql.placeholder('position')}` })
        .where(eq(schema.favorites.contentId, sql.placeholder('contentId')))
        .prepare();

    for (const chunk of chunkValues(updates, DEFAULT_BATCH_SIZE)) {
        await checkpointOperation(control);

        await db.transaction(() => {
            for (const { content_id, position } of chunk) {
                updateFavoritePosition.execute({
                    position,
                    contentId: content_id,
                });
            }
        });

        current += chunk.length;
        await reportOperationProgress(control, {
            phase: 'reordering-global-favorites',
            current,
            total,
            increment: chunk.length,
        });
    }

    return { success: true };
}

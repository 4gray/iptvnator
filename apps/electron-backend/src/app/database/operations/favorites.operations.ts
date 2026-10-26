import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import { XTREAM_FAVORITE_IDENTITY_CONFLICT } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import {
    chunkValues,
    checkpointOperation,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';
import { persistContentMetadataIfMissing } from './content-metadata.operations';

import {
    findFavoriteContent,
    favoriteMatchesContentId,
} from './favorite-catalog';
import { selectFavoriteRows } from './favorite-queries';

const DEFAULT_BATCH_SIZE = 100;

export async function addFavorite(
    db: AppDatabase,
    contentId: number,
    playlistId: string,
    options?: { backdropUrl?: string }
): Promise<{ success: boolean; error?: string }> {
    let content = await findFavoriteContent(db, playlistId, { contentId });
    if (!content)
        throw new Error('Favorite content does not belong to the playlist');
    await persistContentMetadataIfMissing(db, contentId, {
        backdropUrl: options?.backdropUrl,
    });
    content =
        (await findFavoriteContent(db, playlistId, { contentId })) ?? content;
    await db
        .insert(schema.favorites)
        .values({
            contentId,
            playlistId,
            xtreamId: content.xtreamId,
            type: content.type,
            title: content.title,
            posterUrl: content.posterUrl,
            backdropUrl: content.backdropUrl,
            tmdbId: content.tmdbId,
            releaseYear: content.releaseYear,
            originalTitle: content.originalTitle,
        })
        .onConflictDoNothing({
            target: [
                schema.favorites.playlistId,
                schema.favorites.type,
                schema.favorites.xtreamId,
            ],
        });

    // A reused provider ID may already belong to a different saved title.
    // Keep that favorite and acknowledge only a compatible persisted record.
    return (await isFavorite(db, contentId, playlistId))
        ? { success: true }
        : { success: false, error: XTREAM_FAVORITE_IDENTITY_CONFLICT };
}

export async function removeFavorite(
    db: AppDatabase,
    contentId: number | { favoriteId: number },
    playlistId: string
): Promise<{ success: boolean }> {
    await db
        .delete(schema.favorites)
        .where(
            and(
                typeof contentId === 'number'
                    ? favoriteMatchesContentId(contentId)
                    : eq(schema.favorites.id, contentId.favoriteId),
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
                favoriteMatchesContentId(contentId),
                eq(schema.favorites.playlistId, playlistId)
            )
        );

    return result[0].count > 0;
}

export async function getFavorites(db: AppDatabase, playlistId: string) {
    return selectFavoriteRows(db, playlistId);
}

/** Archive export preserves all user-owned favorites, including locked/missing items. */
export async function getFavoritesForBackup(
    db: AppDatabase,
    playlistId: string
) {
    return selectFavoriteRows(db, playlistId, true);
}

export async function getGlobalFavorites(db: AppDatabase) {
    const favorites = await selectFavoriteRows(db);
    return favorites
        .filter((favorite) => favorite.type === 'live')
        .slice(0, 300);
}

export async function getAllGlobalFavorites(db: AppDatabase) {
    return selectFavoriteRows(db).limit(500);
}

export async function reorderGlobalFavorites(
    db: AppDatabase,
    updates: {
        content_id?: number;
        favorite_id?: number;
        playlist_id: string;
        position: number;
    }[],
    control?: OperationControl
): Promise<{ success: boolean }> {
    if (!Array.isArray(updates) || updates.length === 0) {
        return { success: true };
    }

    let current = 0;
    const total = updates.length;

    // Drizzle's .set() doesn't accept a bare Placeholder — wrap it in an
    // sql template so the value resolves to SQL<number> at compile time.
    // Scope by (contentId, playlistId): the favorites table is
    // playlist-scoped, so filtering by contentId alone would also rewrite
    // the position of a same-contentId favorite in another playlist.
    const updateFavoritePosition = db
        .update(schema.favorites)
        .set({ position: sql<number>`${sql.placeholder('position')}` })
        .where(
            and(
                favoriteMatchesContentId(sql.placeholder('contentId')),
                eq(schema.favorites.playlistId, sql.placeholder('playlistId'))
            )
        )
        .prepare();

    const updateByFavoriteId = db
        .update(schema.favorites)
        .set({ position: sql<number>`${sql.placeholder('position')}` })
        .where(
            and(
                eq(schema.favorites.id, sql.placeholder('favoriteId')),
                eq(schema.favorites.playlistId, sql.placeholder('playlistId'))
            )
        )
        .prepare();

    for (const chunk of chunkValues(updates, DEFAULT_BATCH_SIZE)) {
        await checkpointOperation(control);

        await db.transaction(() => {
            for (const {
                content_id,
                favorite_id,
                playlist_id,
                position,
            } of chunk) {
                if (favorite_id !== undefined) {
                    updateByFavoriteId.run({
                        position,
                        favoriteId: favorite_id,
                        playlistId: playlist_id,
                    });
                    continue;
                }
                if (content_id === undefined) continue;
                // Must be .run() (synchronous), NOT .execute(): on the
                // better-sqlite3 driver .execute() defers the write to a
                // resolved promise, which never settles inside this
                // synchronous transaction callback — the UPDATE would be a
                // silent no-op and the custom favorites order would never
                // persist (issue #1137).
                updateFavoritePosition.run({
                    position,
                    contentId: content_id,
                    playlistId: playlist_id,
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

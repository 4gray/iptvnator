import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    normalizeContentMetadataPatch,
    type XtreamBackupFavoriteItem,
} from '@iptvnator/shared/interfaces';
import { reconcileFavoriteIdentity } from './favorite-catalog';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    reportOperationProgress,
    type OperationControl,
} from './operation-control';

function restoreReceiptKey(
    playlistId: string,
    items: XtreamBackupFavoriteItem[],
    restoreId?: string
) {
    // Canonical field order prevents a JSON reserialization from inventing a
    // second legacy conversion and resurrecting a favorite removed meanwhile.
    const payload = items.map((item) => ({
        contentType: item.contentType,
        xtreamId: item.xtreamId,
        addedAt: item.addedAt ?? null,
        position: item.position ?? null,
        snapshot: item.snapshot
            ? {
                  title: item.snapshot.title,
                  posterUrl: item.snapshot.posterUrl ?? null,
                  backdropUrl: item.snapshot.backdropUrl ?? null,
                  tmdbId: item.snapshot.tmdbId ?? null,
                  releaseYear: item.snapshot.releaseYear ?? null,
                  originalTitle: item.snapshot.originalTitle ?? null,
              }
            : null,
    }));
    const digest = createHash('sha256')
        .update(restoreId === undefined ? JSON.stringify(payload) : restoreId)
        .digest('hex');
    return `xtream-favorites-restore:${[...playlistId].length}:${playlistId}:${restoreId === undefined ? 'legacy' : 'backup'}:${digest}`;
}

function favoriteValue(
    db: AppDatabase,
    playlistId: string,
    item: XtreamBackupFavoriteItem,
    index: number
) {
    if (
        !Number.isInteger(item.xtreamId) ||
        !['movie', 'series', 'live'].includes(item.contentType)
    ) {
        throw new Error('Invalid saved favorite identity');
    }
    const candidate = db
        .select({ content: schema.content })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.content.xtreamId, item.xtreamId),
                eq(schema.content.type, item.contentType)
            )
        )
        .orderBy(schema.content.id)
        .limit(1)
        .get()?.content;
    const metadata = normalizeContentMetadataPatch(item.snapshot);
    const conflicts =
        candidate &&
        ((metadata?.tmdbId != null &&
            candidate.tmdbId != null &&
            metadata.tmdbId !== candidate.tmdbId) ||
            (metadata?.releaseYear != null &&
                candidate.releaseYear != null &&
                metadata.releaseYear !== candidate.releaseYear));
    const content = conflicts ? undefined : candidate;
    // Keep a compatible provider link, but do not mix a saved identity with
    // metadata from a returning row that has not confirmed it yet.
    const snapshotContent =
        content &&
        (metadata?.tmdbId == null || metadata.tmdbId === content.tmdbId) &&
        (metadata?.releaseYear == null ||
            metadata.releaseYear === content.releaseYear)
            ? content
            : undefined;
    return {
        playlistId,
        xtreamId: item.xtreamId,
        type: item.contentType,
        contentId: content?.id ?? null,
        identityConflict:
            item.snapshot?.catalogMissingReason === 'identity_conflict',
        title:
            item.snapshot?.title?.trim() ||
            snapshotContent?.title ||
            `Saved ${item.contentType} #${item.xtreamId}`,
        posterUrl: item.snapshot?.posterUrl ?? snapshotContent?.posterUrl,
        backdropUrl: metadata?.backdropUrl ?? snapshotContent?.backdropUrl,
        tmdbId: metadata?.tmdbId ?? snapshotContent?.tmdbId,
        releaseYear: metadata?.releaseYear ?? snapshotContent?.releaseYear,
        originalTitle:
            metadata?.originalTitle ?? snapshotContent?.originalTitle,
        addedAt: item.addedAt ?? new Date().toISOString(),
        position: item.position ?? index,
    };
}

/**
 * One atomic conversion: pending legacy/backup state and its receipt commit
 * together. Reads and writes are synchronous inside the transaction; a failed
 * insert leaves neither partial favorites nor a receipt that would suppress retry.
 * Existing canonical favorites win over replayed metadata and display order.
 */
export async function restoreXtreamFavorites(
    db: AppDatabase,
    playlistId: string,
    favorites: XtreamBackupFavoriteItem[],
    control?: OperationControl,
    restoreId?: string
): Promise<{ success: boolean }> {
    if (favorites.length === 0) return { success: true };
    await checkpointOperation(control);
    const key = restoreReceiptKey(playlistId, favorites, restoreId);
    db.transaction((tx) => {
        if (
            tx
                .select({ key: schema.appState.key })
                .from(schema.appState)
                .where(eq(schema.appState.key, key))
                .get()
        )
            return;
        for (const [index, item] of favorites.entries()) {
            tx.insert(schema.favorites)
                .values(favoriteValue(tx, playlistId, item, index))
                .onConflictDoNothing({
                    target: [
                        schema.favorites.playlistId,
                        schema.favorites.type,
                        schema.favorites.xtreamId,
                    ],
                })
                .run();
        }
        reconcileFavoriteIdentity(
            tx,
            eq(schema.favorites.playlistId, playlistId)
        );
        tx.insert(schema.appState).values({ key, value: 'completed' }).run();
    });
    await reportOperationProgress(control, {
        phase: 'restoring-favorites',
        current: favorites.length,
        total: favorites.length,
        increment: favorites.length,
    });
    return { success: true };
}

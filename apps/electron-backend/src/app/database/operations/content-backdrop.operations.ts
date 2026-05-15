import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';

export async function persistContentBackdropIfMissing(
    db: AppDatabase,
    contentId: number,
    backdropUrl?: string
): Promise<void> {
    const normalizedBackdropUrl = backdropUrl?.trim();
    if (!normalizedBackdropUrl) {
        return;
    }

    await db
        .update(schema.content)
        .set({ backdropUrl: normalizedBackdropUrl })
        .where(
            and(
                eq(schema.content.id, contentId),
                sql`(${schema.content.backdropUrl} IS NULL OR ${schema.content.backdropUrl} = '')`
            )
        );
}

export async function setContentBackdropIfMissing(
    db: AppDatabase,
    contentId: number,
    backdropUrl?: string
): Promise<{ success: boolean }> {
    await persistContentBackdropIfMissing(db, contentId, backdropUrl);
    return { success: true };
}

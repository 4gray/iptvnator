import { eq } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    normalizeXtreamContentTypes,
    normalizeXtreamServerUrl,
    xtreamHistoryRecoveryKey,
    XTREAM_CONTENT_TYPES,
    type XtreamCatalogStateCondition,
    type XtreamCatalogStateResult,
    type XtreamStartupRefreshCondition,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

function validateCondition(condition: XtreamCatalogStateCondition): void {
    if (
        !condition ||
        !['playlistId', 'serverUrl', 'username', 'password'].every(
            (field) =>
                typeof condition[field as keyof XtreamCatalogStateCondition] ===
                'string'
        ) ||
        (condition.userAgent !== undefined &&
            typeof condition.userAgent !== 'string')
    )
        throw new Error('Invalid catalog state condition.');
}

/** One native read classifies terminal errors without modifying recovery. */
export function checkXtreamCatalogConnection(
    db: Pick<AppDatabase, 'select'>,
    condition: XtreamCatalogStateCondition
): XtreamCatalogStateResult {
    validateCondition(condition);
    const row = db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, condition.playlistId))
        .get();
    let matches = false;
    try {
        const payload = row?.payload ? JSON.parse(row.payload) : {};
        matches =
            !!row &&
            row.type === 'xtream' &&
            !!payload &&
            typeof payload === 'object' &&
            !Array.isArray(payload) &&
            normalizeXtreamServerUrl(row.serverUrl ?? '') ===
                normalizeXtreamServerUrl(condition.serverUrl) &&
            (row.username?.trim() ?? '') === condition.username.trim() &&
            (row.password?.trim() ?? '') === condition.password.trim() &&
            (
                row.userAgent ??
                (typeof payload.userAgent === 'string' ? payload.userAgent : '')
            ).trim() === (condition.userAgent?.trim() ?? '');
    } catch {
        /* Malformed connections fail closed without exposing values. */
    }
    return matches
        ? { success: true, conditionChecked: true }
        : { success: false, conditionChecked: true, connectionChanged: true };
}

/** Check the source as stored in SQLite at the start of a guarded write. */
export function matchesXtreamStartupRefresh(
    db: Pick<AppDatabase, 'select'>,
    condition: XtreamStartupRefreshCondition
): boolean {
    if (!checkXtreamCatalogConnection(db, condition).success) return false;
    const row = db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, condition.playlistId))
        .get();
    if (!row) return false;
    const payload = row.payload ? JSON.parse(row.payload) : {};
    const previous =
        row.updateDate ??
        (row.lastUpdated ? Date.parse(row.lastUpdated) : null);
    return (
        Boolean(row.autoRefresh ?? payload.autoRefresh) &&
        normalizeXtreamContentTypes(payload.xtreamContentTypes).includes(
            'live'
        ) &&
        previous === condition.previousUpdateDate
    );
}

export function setXtreamStartupRefreshDate(
    db: AppDatabase,
    updateDate: number,
    condition: XtreamStartupRefreshCondition
): { success: boolean } {
    const lastUpdated = new Date(updateDate);
    if (
        !Number.isSafeInteger(updateDate) ||
        !Number.isFinite(lastUpdated.getTime())
    )
        throw new Error('Invalid Xtream refresh timestamp.');

    return db.transaction((tx) => {
        if (!matchesXtreamStartupRefresh(tx, condition))
            return { success: false };
        tx.update(schema.playlists)
            .set({ updateDate, lastUpdated: lastUpdated.toISOString() })
            .where(eq(schema.playlists.id, condition.playlistId))
            .run();
        return { success: true };
    });
}

/** Compare and commit synchronously: no projection can interleave these steps. */
export function setConditionalCatalogState(
    db: AppDatabase,
    key: string,
    value: string,
    condition: XtreamCatalogStateCondition
): XtreamCatalogStateResult {
    validateCondition(condition);
    const prefix = `xtream-import-status:${condition.playlistId}:`;
    if (!(
        (key === xtreamHistoryRecoveryKey(condition.playlistId) &&
            value === '') ||
        (value === 'completed' &&
            XTREAM_CONTENT_TYPES.some((type) => key === prefix + type))
    ))
        throw new Error('Invalid conditional catalog state write.');
    return db.transaction((tx): XtreamCatalogStateResult => {
        const result = checkXtreamCatalogConnection(tx, condition);
        if (!result.success) return result;
        const updatedAt = new Date().toISOString();
        tx.insert(schema.appState)
            .values({ key, value, updatedAt })
            .onConflictDoUpdate({
                target: schema.appState.key,
                set: { value, updatedAt },
            })
            .run();
        return result;
    });
}

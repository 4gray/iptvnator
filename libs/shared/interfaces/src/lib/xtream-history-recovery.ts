import type { XtreamBackupRecentlyViewedItem } from './playlist-backup.interface';
import {
    XTREAM_CONTENT_TYPES,
    XtreamContentType,
} from './xtream-content-selection';

export const XTREAM_HISTORY_RECOVERY_PREFIX = 'xtream-history-recovery:';
export const xtreamHistoryRecoveryKey = (playlistId: string) =>
    XTREAM_HISTORY_RECOVERY_PREFIX + playlistId;

export interface XtreamHistoryRecovery {
    version: 1;
    contentTypes: XtreamContentType[];
    recentlyViewed: XtreamBackupRecentlyViewedItem[];
    removed?: Pick<
        XtreamBackupRecentlyViewedItem,
        'contentType' | 'xtreamId'
    >[];
    cleared?: true;
}

/** Internal durable state: malformed journals must fail closed, never lose rows. */
export function parseXtreamHistoryRecovery(raw: string): XtreamHistoryRecovery {
    const value = JSON.parse(raw) as XtreamHistoryRecovery;
    if (
        value?.version !== 1 ||
        !Array.isArray(value.contentTypes) ||
        !value.contentTypes.every((type) =>
            XTREAM_CONTENT_TYPES.includes(type)
        ) ||
        !Array.isArray(value.recentlyViewed) ||
        !value.recentlyViewed.every(
            (row) =>
                row &&
                XTREAM_CONTENT_TYPES.includes(row.contentType) &&
                typeof row.xtreamId === 'number' &&
                Number.isFinite(row.xtreamId) &&
                typeof row.viewedAt === 'string' &&
                row.viewedAt.length > 0
        ) ||
        (value.cleared !== undefined && value.cleared !== true) ||
        (value.removed !== undefined &&
            (!Array.isArray(value.removed) ||
                !value.removed.every(
                    (row) =>
                        row &&
                        XTREAM_CONTENT_TYPES.includes(row.contentType) &&
                        typeof row.xtreamId === 'number' &&
                        Number.isFinite(row.xtreamId)
                )))
    )
        throw new Error('Catalog history recovery is unreadable.');
    return value;
}

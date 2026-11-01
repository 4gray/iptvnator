import { and, eq, inArray, like } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    parseXtreamHistoryRecovery,
    XTREAM_HISTORY_RECOVERY_PREFIX,
    xtreamHistoryRecoveryKey,
    type XtreamBackupRecentlyViewedItem,
    type XtreamHistoryRecovery,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

type HistoryDatabase = Pick<
    AppDatabase,
    'select' | 'insert' | 'delete' | 'update'
>;
const identity = (
    row: Pick<XtreamBackupRecentlyViewedItem, 'contentType' | 'xtreamId'>
) => `${row.contentType}:${row.xtreamId}`;

export function readHistoryRecovery(
    db: HistoryDatabase,
    playlistId: string
): XtreamHistoryRecovery | null {
    const row = db
        .select()
        .from(schema.appState)
        .where(eq(schema.appState.key, xtreamHistoryRecoveryKey(playlistId)))
        .get();
    return row?.value ? parseXtreamHistoryRecovery(row.value) : null;
}

function writeHistoryRecovery(
    db: HistoryDatabase,
    playlistId: string,
    value: XtreamHistoryRecovery
): void {
    parseXtreamHistoryRecovery(JSON.stringify(value));
    const record = {
        key: xtreamHistoryRecoveryKey(playlistId),
        value: JSON.stringify(value),
        updatedAt: new Date().toISOString(),
    };
    db.insert(schema.appState)
        .values(record)
        .onConflictDoUpdate({ target: schema.appState.key, set: record })
        .run();
}

function liveHistory(
    db: HistoryDatabase,
    playlistId: string
): XtreamBackupRecentlyViewedItem[] {
    return db
        .select({
            contentType: schema.content.type,
            xtreamId: schema.content.xtreamId,
            viewedAt: schema.recentlyViewed.viewedAt,
        })
        .from(schema.recentlyViewed)
        .innerJoin(
            schema.content,
            eq(schema.recentlyViewed.contentId, schema.content.id)
        )
        .where(eq(schema.recentlyViewed.playlistId, playlistId))
        .all()
        .map((row) => ({
            ...row,
            viewedAt: row.viewedAt ?? new Date().toISOString(),
        })) as XtreamBackupRecentlyViewedItem[];
}

/** Captures live history and merges owned archives without undoing removals. */
export function beginHistoryRecovery(
    db: AppDatabase,
    playlistId: string,
    incoming: XtreamHistoryRecovery
): void {
    db.transaction((tx) => {
        const previous = readHistoryRecovery(tx, playlistId);
        const removed = new Set(previous?.removed?.map(identity));
        const archived = incoming.recentlyViewed.filter(
            (row) => !previous?.cleared && !removed.has(identity(row))
        );
        const rows = new Map(
            [
                ...archived,
                ...(previous?.recentlyViewed ?? []),
                ...liveHistory(tx, playlistId),
            ].map((row) => [identity(row), row])
        );
        writeHistoryRecovery(tx, playlistId, {
            ...(previous ?? {}),
            version: 1,
            contentTypes: [
                ...new Set([
                    ...(previous?.contentTypes ?? []),
                    ...incoming.contentTypes,
                ]),
            ],
            recentlyViewed: [...rows.values()],
        });
    });
}

/** Called inside the same transaction as the live watch-history write. */
export function recordRecoveredHistory(
    db: HistoryDatabase,
    playlistId: string,
    contentId: number
): void {
    const journal = readHistoryRecovery(db, playlistId);
    if (!journal) return;
    const row = db
        .select({
            contentType: schema.content.type,
            xtreamId: schema.content.xtreamId,
            viewedAt: schema.recentlyViewed.viewedAt,
        })
        .from(schema.recentlyViewed)
        .innerJoin(
            schema.content,
            eq(schema.recentlyViewed.contentId, schema.content.id)
        )
        .where(
            and(
                eq(schema.recentlyViewed.playlistId, playlistId),
                eq(schema.content.id, contentId)
            )
        )
        .get() as XtreamBackupRecentlyViewedItem | undefined;
    if (!row) return;
    journal.recentlyViewed = journal.recentlyViewed.filter(
        (item) => identity(item) !== identity(row)
    );
    journal.recentlyViewed.push(row);
    if (journal.removed)
        journal.removed = journal.removed.filter(
            (item) => identity(item) !== identity(row)
        );
    writeHistoryRecovery(db, playlistId, journal);
}

export function removeRecoveredHistory(
    db: HistoryDatabase,
    items: { contentId: number; playlistId: string }[]
): void {
    const grouped = new Map<string, number[]>();
    for (const item of items) {
        const ids = grouped.get(item.playlistId) ?? [];
        ids.push(item.contentId);
        grouped.set(item.playlistId, ids);
    }
    for (const [playlistId, ids] of grouped) {
        const journal = readHistoryRecovery(db, playlistId);
        if (!journal) continue;
        const removed = new Set<string>();
        const tombstones = new Map(
            (journal.removed ?? []).map((row) => [identity(row), row])
        );
        for (let offset = 0; offset < ids.length; offset += 1000) {
            for (const row of db
                .select({
                    contentType: schema.content.type,
                    xtreamId: schema.content.xtreamId,
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        inArray(
                            schema.content.id,
                            ids.slice(offset, offset + 1000)
                        )
                    )
                )
                .all()) {
                removed.add(`${row.contentType}:${row.xtreamId}`);
                const entry = {
                    contentType:
                        row.contentType as XtreamBackupRecentlyViewedItem['contentType'],
                    xtreamId: row.xtreamId,
                };
                tombstones.set(identity(entry), entry);
            }
        }
        journal.recentlyViewed = journal.recentlyViewed.filter(
            (row) => !removed.has(identity(row))
        );
        journal.removed = [...tombstones.values()];
        writeHistoryRecovery(db, playlistId, journal);
    }
}

export function clearRecoveredHistory(
    db: HistoryDatabase,
    playlistId?: string
): void {
    if (playlistId) {
        const journal = readHistoryRecovery(db, playlistId);
        if (journal)
            writeHistoryRecovery(db, playlistId, {
                ...journal,
                recentlyViewed: [],
                removed: [],
                cleared: true,
            });
        return;
    }
    for (const row of db
        .select()
        .from(schema.appState)
        .where(like(schema.appState.key, XTREAM_HISTORY_RECOVERY_PREFIX + '%'))
        .all()) {
        if (row.value) {
            const journal = parseXtreamHistoryRecovery(row.value);
            writeHistoryRecovery(
                db,
                row.key.slice(XTREAM_HISTORY_RECOVERY_PREFIX.length),
                { ...journal, recentlyViewed: [], removed: [], cleared: true }
            );
        }
    }
}

export function deleteHistoryRecovery(
    db: HistoryDatabase,
    playlistId?: string
): void {
    db.delete(schema.appState)
        .where(
            playlistId
                ? eq(schema.appState.key, xtreamHistoryRecoveryKey(playlistId))
                : like(
                      schema.appState.key,
                      XTREAM_HISTORY_RECOVERY_PREFIX + '%'
                  )
        )
        .run();
}

/** One transaction prevents live history changes from being overwritten mid-replay. */
export function replayRecoveredHistory(
    db: AppDatabase,
    playlistId: string
): number | null {
    return db.transaction((tx) => {
        const journal = readHistoryRecovery(tx, playlistId);
        if (!journal) return null;
        const ids = [
            ...new Set(journal.recentlyViewed.map((row) => row.xtreamId)),
        ];
        const content = new Map<string, number>();
        for (let offset = 0; offset < ids.length; offset += 1000) {
            const rows = tx
                .select({
                    id: schema.content.id,
                    contentType: schema.content.type,
                    xtreamId: schema.content.xtreamId,
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        inArray(
                            schema.content.xtreamId,
                            ids.slice(offset, offset + 1000)
                        )
                    )
                )
                .all();
            for (const row of rows)
                content.set(`${row.contentType}:${row.xtreamId}`, row.id);
        }
        const rows = journal.recentlyViewed
            .map((row) => ({
                contentId: content.get(identity(row)),
                playlistId,
                viewedAt: row.viewedAt,
            }))
            .filter(
                (
                    row
                ): row is {
                    contentId: number;
                    playlistId: string;
                    viewedAt: string;
                } => row.contentId !== undefined
            );
        tx.delete(schema.recentlyViewed)
            .where(eq(schema.recentlyViewed.playlistId, playlistId))
            .run();
        for (let offset = 0; offset < rows.length; offset += 1000)
            tx.insert(schema.recentlyViewed)
                .values(rows.slice(offset, offset + 1000))
                .run();
        return rows.length;
    });
}

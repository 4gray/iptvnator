import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

/**
 * Upper bound on the content rows one committed transaction removes or
 * inserts.
 *
 * Catalog writes used to commit every 100 rows (#1292). Each commit flushes
 * the FTS5 trigram pending buffer into a new segment, appends the dirty pages
 * of every `content` index to the WAL again, and roughly every 4 MB of WAL
 * runs an fsync-ing auto-checkpoint. On a 900k-row database that turned a
 * 3 s set-based delete of one 300k-row playlist into 12–15 s and wrote 2 GB
 * of WAL where one transaction writes 140 MB; the insert side behaved the
 * same way. One giant transaction is not the answer either: the worker only
 * serves other requests between awaits, cancellation is cooperative between
 * commits, and the main-process and EPG-worker connections give up after
 * their 5 s `busy_timeout` while a write transaction holds the lock. Around
 * 5,000 rows keeps a commit near 100 ms on a laptop SSD.
 */
export const CONTENT_ROWS_PER_TRANSACTION = 5000;

/** How many content rows reference one category. */
export interface CategoryRowCount {
    readonly categoryId: number;
    readonly rowCount: number;
}

/**
 * Rejects a filter that would drop every row of a table.
 *
 * Drizzle's `and()` returns `undefined` for an empty condition list, and
 * `.where(undefined)` is a full-table delete. The scoped deletes below never
 * intend that, so an unbounded filter is a bug worth failing on.
 */
export function requireScopedFilter(filter: SQL | undefined): SQL {
    if (!filter) {
        throw new Error('Refusing an unscoped catalog delete');
    }
    return filter;
}

/**
 * Content row counts per category for the categories matching
 * `categoryFilter`, read from two covering indexes without touching a row.
 */
export async function countContentRowsByCategory(
    db: AppDatabase,
    categoryFilter: SQL
): Promise<CategoryRowCount[]> {
    return db
        .select({
            categoryId: schema.content.categoryId,
            rowCount: sql<number>`count(*)`,
        })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(categoryFilter)
        .groupBy(schema.content.categoryId);
}

export function sumCategoryRowCounts(
    counts: readonly CategoryRowCount[]
): number {
    return counts.reduce((total, count) => total + count.rowCount, 0);
}

/**
 * Packs categories into groups whose combined row count stays within
 * `rowBudget`, preserving input order. A category larger than the budget
 * forms a group of its own and is deleted in one statement: bounding it
 * further would need id-ranged sub-deletes, and the largest real categories
 * seen so far (~45k rows) still commit in well under a second. Categories
 * without content are skipped — there is nothing to delete under them.
 */
export function groupCategoriesByRowBudget(
    counts: readonly CategoryRowCount[],
    rowBudget: number
): number[][] {
    const groups: number[][] = [];
    let group: number[] = [];
    let groupRows = 0;

    for (const { categoryId, rowCount } of counts) {
        if (rowCount <= 0) {
            continue;
        }
        if (group.length > 0 && groupRows + rowCount > rowBudget) {
            groups.push(group);
            group = [];
            groupRows = 0;
        }
        group.push(categoryId);
        groupRows += rowCount;
    }

    if (group.length > 0) {
        groups.push(group);
    }

    return groups;
}

export interface ContentDeletionOptions {
    readonly control?: OperationControl;
    /** Progress phase reported after every committed group. */
    readonly phase: string;
    readonly rowsPerTransaction?: number;
}

/**
 * Deletes the content under the counted categories, one budgeted group per
 * transaction, with a cooperative checkpoint before each commit and a
 * progress report after it. Returns the number of rows SQLite removed.
 */
export async function deleteContentByCategoryGroups(
    db: AppDatabase,
    counts: readonly CategoryRowCount[],
    options: ContentDeletionOptions
): Promise<number> {
    const total = sumCategoryRowCounts(counts);
    const groups = groupCategoriesByRowBudget(
        counts,
        options.rowsPerTransaction ?? CONTENT_ROWS_PER_TRANSACTION
    );
    let deleted = 0;

    for (const group of groups) {
        await checkpointOperation(options.control);
        const changes = await db.transaction(
            (tx) =>
                tx
                    .delete(schema.content)
                    .where(inArray(schema.content.categoryId, group))
                    .run().changes
        );
        deleted += changes;
        await reportOperationProgress(options.control, {
            phase: options.phase,
            current: deleted,
            total,
            increment: changes,
        });
    }

    return deleted;
}

/**
 * Deletes every category matching `categoryFilter` in one transaction and
 * returns the number of rows removed. Content still referencing one of them
 * goes with it through `ON DELETE CASCADE`.
 */
export async function deleteCategoriesWhere(
    db: AppDatabase,
    categoryFilter: SQL
): Promise<number> {
    return db.transaction(
        (tx) =>
            tx.delete(schema.categories).where(categoryFilter).run().changes
    );
}

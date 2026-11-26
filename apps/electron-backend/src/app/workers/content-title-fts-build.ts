import type BetterSqlite3 from 'better-sqlite3';
import {
    buildContentTitleFtsBatch,
    type ContentTitleFtsBatch,
} from '@iptvnator/shared/database/content-title-fts';

/**
 * Fills the title index that `initDatabase()` left for the database worker,
 * one short transaction per batch. Between batches the worker answers its
 * requests, so a read waits for one batch at most. Search uses the live
 * index until the finished one is swapped in.
 *
 * A worker closed or terminated mid-build keeps every committed batch; the
 * next launch resumes from the cursor.
 */

/** About 20-60 ms of indexing per batch. */
export const CONTENT_TITLE_FTS_BUILD_BATCH_SIZE = 5_000;
/** Leaves the first launch reads to the worker before the build starts. */
export const CONTENT_TITLE_FTS_BUILD_START_DELAY_MS = 3_000;
/** A busy database (an EPG import's write) is retried, then left to the next launch. */
export const CONTENT_TITLE_FTS_BUILD_RETRY_DELAY_MS = 5_000;
export const CONTENT_TITLE_FTS_BUILD_MAX_FAILURES = 3;

export type ContentTitleFtsBuildOutcome = 'done' | 'idle' | 'failed';

export interface ContentTitleFtsBuildDeps {
    readonly getSqlite: () => Promise<BetterSqlite3.Database>;
    readonly buildBatch?: (
        sqlite: BetterSqlite3.Database,
        batchSize: number
    ) => ContentTitleFtsBatch;
    readonly wait?: (ms: number) => Promise<void>;
    readonly yieldToRequests?: () => Promise<void>;
    readonly batchSize?: number;
    readonly startDelayMs?: number;
    readonly log?: (message: string) => void;
}

const defaultWait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultYield = () =>
    new Promise<void>((resolve) => setImmediate(resolve));

export async function runContentTitleFtsBuild(
    deps: ContentTitleFtsBuildDeps
): Promise<ContentTitleFtsBuildOutcome> {
    const buildBatch = deps.buildBatch ?? buildContentTitleFtsBatch;
    const wait = deps.wait ?? defaultWait;
    const yieldToRequests = deps.yieldToRequests ?? defaultYield;
    const batchSize = deps.batchSize ?? CONTENT_TITLE_FTS_BUILD_BATCH_SIZE;
    const log = deps.log ?? ((message) => console.warn(message));

    await wait(deps.startDelayMs ?? CONTENT_TITLE_FTS_BUILD_START_DELAY_MS);
    let failures = 0;
    for (;;) {
        let state: ContentTitleFtsBatch;
        try {
            state = buildBatch(await deps.getSqlite(), batchSize);
        } catch (error) {
            failures++;
            // The message only: better-sqlite3 names no path or bound value.
            log(
                `[DB Worker] Title index build batch failed (${failures}/${CONTENT_TITLE_FTS_BUILD_MAX_FAILURES}): ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            if (failures >= CONTENT_TITLE_FTS_BUILD_MAX_FAILURES) {
                return 'failed';
            }
            await wait(CONTENT_TITLE_FTS_BUILD_RETRY_DELAY_MS);
            continue;
        }
        failures = 0;
        if (state !== 'pending') return state;
        await yieldToRequests();
    }
}

let running: Promise<ContentTitleFtsBuildOutcome> | null = null;

/** Starts the build unless one is already running in this worker. */
export function startContentTitleFtsBuild(
    deps: ContentTitleFtsBuildDeps
): Promise<ContentTitleFtsBuildOutcome> {
    running ??= runContentTitleFtsBuild(deps).finally(() => {
        running = null;
    });
    return running;
}

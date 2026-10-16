import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';
import {
    behind,
    type EditStep,
    splitEditKey,
    uncertain,
    UNKNOWN_TAG,
    yielding,
} from './server-user-data-entries';
import { replaySteps } from './server-user-data-edit';
import type { UserDataWriteQueue } from './server-user-data-queue';
import type { UserDataStorage } from '../user-data-storage';
import type { DeferredEdit } from './server-user-data-edit';
import { othersUnconfirmed } from './server-page-registry';
import { readDeferredEdits, readUnsentWrites } from './server-unsent-writes';
import type { UserDataCache } from './server-user-data-cache';

/**
 * A closed tab's saved edits, ahead of this tab's own (which may have been
 * made on them): sent with them, replayed first on a conflict, and only
 * where the entry is still as that tab saw it (`yields`): a change made
 * since, here or elsewhere, is newer. Returns the value to show.
 */
export function adoptEdits(
    writes: UserDataWriteQueue,
    namespace: ServerUserStateNamespace,
    playlistId: string,
    current: unknown,
    steps: readonly EditStep[],
    foreign: boolean
): unknown {
    const key = `${namespace}|${playlistId}`;
    const adopted = yielding(steps);
    const queued = writes.isQueued(key) ? writes.unsent(key) : undefined;
    // Without a server version this page read, the write must conflict and
    // be replayed on the server's value, never overwrite it blindly.
    const unknown =
        foreign ||
        (queued ? queued.tag : writes.tags.of(namespace, playlistId)) ===
            undefined;
    if (queued) {
        // This tab's queued edits are newer: they replay last.
        const all = [...adopted, ...queued.steps];
        const value = replaySteps(queued.steps[0]?.before, all);
        writes.put({
            ...queued,
            value,
            steps: all,
            tag: unknown ? UNKNOWN_TAG : queued.tag,
        });
        return value;
    }
    const value = replaySteps(current, adopted);
    writes.queue(namespace, playlistId, value, value, { foreign: unknown });
    const entry = writes.unsent(key);
    if (entry) {
        writes.put({ ...entry, steps: [...adopted, ...entry.steps] });
    }
    return value;
}

/**
 * Early edits made on this tab's own unsent write: kept as their own steps
 * after it, so a conflict replays them in order.
 */
export function extendUnsent(
    writes: UserDataWriteQueue,
    key: string,
    steps: readonly EditStep[]
): void {
    const entry = writes.unsent(key);
    if (entry) {
        writes.put({
            ...entry,
            value: replaySteps(entry.value, steps),
            steps: [
                ...(writes.isQueued(key) ? entry.steps : behind(entry)),
                ...steps,
            ],
        });
    }
}

/**
 * A reload of this tab: its last page load's saved writes are queued and
 * its early edits kept, both as this page's own.
 */
export function restorePage(
    writes: UserDataWriteQueue,
    deferred: Map<string, DeferredEdit>,
    local: UserDataStorage,
    instanceId: string,
    page: string
): void {
    for (const write of readUnsentWrites(local, instanceId, page)) {
        const key = `${write.namespace}|${write.playlistId}`;
        const queued = writes.isQueued(key) ? writes.unsent(key) : undefined;
        if (queued) {
            // An older page load's copy came first: these steps follow it.
            writes.put({
                ...queued,
                value: write.value,
                steps: [...queued.steps, ...uncertain(write.steps)],
            });
            continue;
        }
        writes.queue(
            write.namespace,
            write.playlistId,
            write.value,
            undefined,
            {
                tag: write.tag,
                steps: write.steps,
            }
        );
    }
    for (const edit of readDeferredEdits(local, instanceId, page)) {
        const key = `${edit.namespace}|${edit.playlistId}`;
        deferred.set(key, {
            ...edit,
            steps: [...(deferred.get(key)?.steps ?? []), ...edit.steps],
        });
    }
}

/**
 * Flushes until nothing (of `playlistId`) is queued or travelling, a few
 * rounds for conflict replays: false when some stays unsent (refused, or
 * offline).
 */
export async function settleWrites(
    writes: UserDataWriteQueue,
    playlistId?: string
): Promise<boolean> {
    const unsent = () =>
        writes
            .unconfirmedKeys()
            .some(
                (key) =>
                    playlistId === undefined ||
                    splitEditKey(key)[1] === playlistId
            );
    for (let round = 0; round < 3 && unsent(); round += 1) {
        await writes.flush();
    }
    return !unsent();
}

/**
 * Another page load's saved writes and early edits, shown on what this tab
 * shows now and queued with its writes (also when the cache shows them).
 */
export function adoptPageEdits(
    writes: UserDataWriteQueue,
    cache: UserDataCache,
    from: {
        readonly local: UserDataStorage;
        readonly instanceId: string;
        readonly tabId: string;
        readonly page: string;
    }
): void {
    const { local, instanceId, tabId, page } = from;
    const foreign = othersUnconfirmed(local, instanceId, tabId);
    for (const { namespace, playlistId, steps } of [
        ...readDeferredEdits(local, instanceId, page),
        ...readUnsentWrites(local, instanceId, page),
    ]) {
        const value = adoptEdits(
            writes,
            namespace,
            playlistId,
            cache.map(namespace)[playlistId],
            steps,
            foreign.has(`${namespace}|${playlistId}`)
        );
        cache.setEntry(namespace, playlistId, value);
    }
}

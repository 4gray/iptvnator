import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';
import {
    behind,
    type EditStep,
    uncertain,
    UNKNOWN_TAG,
} from './server-user-data-entries';
import { replaySteps } from './server-user-data-edit';
import type { UserDataWriteQueue } from './server-user-data-queue';

/**
 * A closed tab's saved edits, ahead of this tab's own (which may have been
 * made on them): sent with them, replayed first on a conflict. Returns the
 * value to show.
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
    const adopted = uncertain(steps);
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
    const value = replaySteps(current, steps);
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

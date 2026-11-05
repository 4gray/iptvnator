import type {
    ServerUserStateCurrent,
    ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import {
    entryKey,
    type PendingEntry,
    uncertain,
    UNKNOWN_TAG,
} from './server-user-data-entries';
import { replaySteps } from './server-user-data-edit';
import type { WriteOutcome } from './server-user-data-send';
import type { UserStateTags } from './server-user-data-tags';

/** The parts of `UserDataWriteQueue` a write's answer changes. */
export interface AnsweredWrites {
    /** Queued entries, by entry key. */
    readonly pending: Map<string, PendingEntry>;
    /** Writes still travelling, by entry key. */
    readonly inFlight: Map<string, PendingEntry>;
    /** This tab's newest edit number per entry key. */
    readonly edits: Map<string, number>;
    readonly tags: UserStateTags;
    /** A replay or a deleted playlist changed what an entry should show. */
    readonly show: (
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ) => void;
    readonly writeFailed: (error: unknown) => void;
    /** A replayed edit is queued: send it soon. */
    readonly scheduleFlush: () => void;
}

/**
 * Applies the answer to a travelling write: a saved one hands its version
 * to the edit queued behind it, a `412` replays the edit on the server's
 * value, a deleted playlist takes its edit along, and a failed one goes
 * back into the queue.
 */
export function applyAnswer(
    writes: AnsweredWrites,
    entry: PendingEntry,
    outcome: WriteOutcome
): void {
    retireInFlight(writes, entry);
    if (outcome.status === 'saved') {
        confirmed(writes, entry, outcome.tag);
    } else if (outcome.status === 'conflict') {
        replayOnConflict(writes, entry, outcome.current);
    } else if (outcome.status === 'gone') {
        gone(writes, entry);
    } else {
        requeue(writes, entry);
        // A refused page-hide write is retried as quietly as it went.
        if ('error' in outcome) {
            writes.writeFailed(outcome.error);
        }
    }
}

/** A newer write of the same entry may have replaced it meanwhile. */
function retireInFlight(writes: AnsweredWrites, entry: PendingEntry): void {
    const key = entryKey(entry);
    if (writes.inFlight.get(key)?.edit === entry.edit) {
        writes.inFlight.delete(key);
    }
}

/**
 * Back into the queue after a failed write, for the offline retry or
 * the next edit, unless the entry was edited since it was sent.
 */
function requeue(writes: AnsweredWrites, entry: PendingEntry): void {
    const key = entryKey(entry);
    if (writes.edits.get(key) === entry.edit && !writes.pending.has(key)) {
        writes.pending.set(key, { ...entry, steps: uncertain(entry.steps) });
    }
}

/** The playlist was deleted elsewhere: its edit goes with it. */
function gone(writes: AnsweredWrites, entry: PendingEntry): void {
    const key = entryKey(entry);
    if (writes.edits.get(key) === entry.edit) {
        writes.edits.delete(key);
        writes.show(entry.namespace, entry.playlistId, undefined);
    }
}

/**
 * The server took `entry`: the edit queued behind it builds on it.
 * Without a readable tag (a body cut off after its headers) a conditional
 * write leaves the version unknown: a newer edit drops the landed steps
 * all the same and conflicts, so only the edits made after it replay. An
 * unconditional one stays unconditional.
 */
function confirmed(
    writes: AnsweredWrites,
    entry: PendingEntry,
    read: string | null | undefined
): void {
    const tag =
        read !== undefined || entry.tag === undefined ? read : UNKNOWN_TAG;
    if (tag !== undefined) {
        writes.tags.update(entry.namespace, entry.playlistId, tag);
    }
    const key = entryKey(entry);
    const next = writes.pending.get(key);
    if (next?.steps.some((step) => step.sent === entry.edit)) {
        // A foreign edit stays unknown: its baseline is not this value.
        writes.pending.set(key, {
            ...next,
            steps: next.steps.filter((step) => step.sent !== entry.edit),
            tag: next.tag === UNKNOWN_TAG || tag === undefined ? next.tag : tag,
        });
    }
}

/**
 * Another device changed the entry and `entry` did not land: replay its
 * steps on the server's current value (with the newer queued edit that
 * carries them, if any), show the result and send it on that version.
 */
function replayOnConflict(
    writes: AnsweredWrites,
    entry: PendingEntry,
    current: ServerUserStateCurrent
): void {
    writes.tags.update(entry.namespace, entry.playlistId, current.tag);
    const key = entryKey(entry);
    const latest =
        writes.pending.get(key) ??
        (writes.edits.get(key) === entry.edit ? entry : undefined);
    if (!latest) {
        return;
    }
    const merged = replaySteps(current.value, latest.steps);
    writes.show(entry.namespace, entry.playlistId, merged);
    if (
        latest === entry &&
        JSON.stringify(merged) === JSON.stringify(current.value)
    ) {
        return;
    }
    // A closed tab's steps keep giving way to newer changes at the next
    // conflict; this page's own become one edit on top of them.
    const yielding = latest.steps.filter((step) => step.yields);
    writes.pending.set(key, {
        ...latest,
        value: merged,
        tag: current.tag,
        steps: [
            ...yielding,
            { before: replaySteps(current.value, yielding), after: merged },
        ],
    });
    writes.scheduleFlush();
}

import { Injectable } from '@angular/core';
import {
    getXtreamPendingRestoreStorageKey,
    normalizeXtreamPendingRestoreState,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

export interface XtreamPendingRestoreSnapshot {
    readonly playlistId: string;
    readonly revision: number;
    readonly state: XtreamPendingRestoreState;
}

export type XtreamPendingRestoreApplicationResult =
    | 'consumed'
    | 'superseded'
    | 'consume-failed';

@Injectable({
    providedIn: 'root',
})
export class XtreamPendingRestoreService {
    private readonly restoreApplicationTails = new Map<
        string,
        Promise<void>
    >();
    private readonly restoreRevisions = new Map<
        string,
        { revision: number; serializedState: string }
    >();
    private readonly lastConsumedRevisions = new Map<string, number>();
    private nextRestoreRevision = 0;

    get(playlistId: string): XtreamPendingRestoreState | null {
        try {
            return this.getOrThrow(playlistId);
        } catch {
            return null;
        }
    }

    /**
     * Strict restore-path read. Storage access failures are not equivalent to
     * an absent snapshot: callers that could expose mutable content must fail
     * closed until they can prove the state is missing or consumed.
     */
    getOrThrow(playlistId: string): XtreamPendingRestoreState | null {
        if (!playlistId) {
            return null;
        }

        const rawState = localStorage.getItem(
            getXtreamPendingRestoreStorageKey(playlistId)
        );
        if (!rawState) {
            return null;
        }

        try {
            // Persisted state may predate the current build (e.g. entries
            // written by versions affected by issue #1017), so it is
            // re-normalized on every read, not only on write.
            return normalizeXtreamPendingRestoreState(JSON.parse(rawState));
        } catch {
            return null;
        }
    }

    getSnapshotOrThrow(
        playlistId: string
    ): XtreamPendingRestoreSnapshot | null {
        const state = this.getOrThrow(playlistId);
        if (!state) {
            this.restoreRevisions.delete(playlistId);
            return null;
        }

        const serializedState = JSON.stringify(state);
        let revision = this.restoreRevisions.get(playlistId);
        if (!revision || revision.serializedState !== serializedState) {
            revision = {
                revision: ++this.nextRestoreRevision,
                serializedState,
            };
            this.restoreRevisions.set(playlistId, revision);
            this.lastConsumedRevisions.delete(playlistId);
        }

        return {
            playlistId,
            revision: revision.revision,
            state,
        };
    }

    set(
        playlistId: string,
        state: XtreamPendingRestoreState
    ): XtreamPendingRestoreSnapshot | null {
        if (!playlistId) {
            return null;
        }

        const normalizedState = normalizeXtreamPendingRestoreState(state);
        const serializedState = JSON.stringify(normalizedState);

        try {
            const storageKey = getXtreamPendingRestoreStorageKey(playlistId);
            localStorage.setItem(storageKey, serializedState);
            if (localStorage.getItem(storageKey) !== serializedState) {
                return null;
            }
        } catch {
            return null;
        }

        const revision = ++this.nextRestoreRevision;
        this.restoreRevisions.set(playlistId, {
            revision,
            serializedState,
        });
        this.lastConsumedRevisions.delete(playlistId);
        return {
            playlistId,
            revision,
            state: normalizedState,
        };
    }

    /**
     * Serializes state-bound restore consumers for one playlist. Consumers of
     * the same revision coalesce after the first succeeds, while a newer
     * revision remains parked for the importer whose content generation is
     * ready to accept it.
     */
    async applyAndConsume(
        playlistId: string,
        expectedSnapshot: XtreamPendingRestoreSnapshot,
        apply: (state: XtreamPendingRestoreState) => Promise<void>
    ): Promise<XtreamPendingRestoreApplicationResult> {
        if (
            !playlistId ||
            expectedSnapshot.playlistId !== playlistId
        ) {
            return 'consume-failed';
        }

        return this.enqueueRestoreApplication(playlistId, async () => {
            const currentSnapshot = this.getSnapshotOrThrow(playlistId);
            if (!currentSnapshot) {
                return this.lastConsumedRevisions.get(playlistId) ===
                    expectedSnapshot.revision
                    ? 'consumed'
                    : 'superseded';
            }
            if (
                currentSnapshot.revision !== expectedSnapshot.revision
            ) {
                return 'superseded';
            }

            await apply(currentSnapshot.state);

            const snapshotAfterApply =
                this.getSnapshotOrThrow(playlistId);
            if (
                !snapshotAfterApply ||
                snapshotAfterApply.revision !== expectedSnapshot.revision
            ) {
                return 'superseded';
            }
            if (!this.clear(playlistId, snapshotAfterApply.state)) {
                return 'consume-failed';
            }

            this.lastConsumedRevisions.set(
                playlistId,
                expectedSnapshot.revision
            );
            return 'consumed';
        });
    }

    clear(
        playlistId: string,
        expectedState?: XtreamPendingRestoreState
    ): boolean {
        if (!playlistId) {
            return false;
        }

        if (expectedState) {
            let currentState: XtreamPendingRestoreState | null;
            try {
                currentState = this.getOrThrow(playlistId);
            } catch {
                return false;
            }

            if (
                !currentState ||
                !this.restoreStatesEqual(currentState, expectedState)
            ) {
                return false;
            }
        }

        const storageKey = getXtreamPendingRestoreStorageKey(playlistId);
        let tombstoneStored = false;

        // An empty value is already treated as "no pending restore" by get().
        // Persist it first so a throwing or no-op remove cannot leave the old
        // snapshot eligible for a later destructive replay.
        try {
            localStorage.setItem(storageKey, '');
            tombstoneStored = localStorage.getItem(storageKey) === '';
        } catch {
            // Removal may still work when writing is unavailable.
        }

        try {
            localStorage.removeItem(storageKey);
            if (localStorage.getItem(storageKey) === null) {
                this.restoreRevisions.delete(playlistId);
                return true;
            }
        } catch {
            // A verified tombstone is sufficient even if removal fails.
        }

        if (tombstoneStored) {
            this.restoreRevisions.delete(playlistId);
        }
        return tombstoneStored;
    }

    private restoreStatesEqual(
        left: XtreamPendingRestoreState,
        right: XtreamPendingRestoreState
    ): boolean {
        return (
            JSON.stringify(normalizeXtreamPendingRestoreState(left)) ===
            JSON.stringify(normalizeXtreamPendingRestoreState(right))
        );
    }

    private enqueueRestoreApplication<T>(
        playlistId: string,
        apply: () => Promise<T>
    ): Promise<T> {
        const previous =
            this.restoreApplicationTails.get(playlistId) ?? Promise.resolve();
        const result = previous.then(apply);
        const tail = result.then(
            () => undefined,
            () => undefined
        );
        this.restoreApplicationTails.set(playlistId, tail);
        void tail.then(() => {
            if (this.restoreApplicationTails.get(playlistId) === tail) {
                this.restoreApplicationTails.delete(playlistId);
            }
        });
        return result;
    }
}

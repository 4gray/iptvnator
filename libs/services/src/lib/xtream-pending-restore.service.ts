import { Injectable } from '@angular/core';
import {
    getXtreamPendingRestoreStorageKey,
    normalizeXtreamPendingRestoreState,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

@Injectable({
    providedIn: 'root',
})
export class XtreamPendingRestoreService {
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

    set(playlistId: string, state: XtreamPendingRestoreState): void {
        if (!playlistId) {
            return;
        }

        try {
            localStorage.setItem(
                getXtreamPendingRestoreStorageKey(playlistId),
                JSON.stringify(normalizeXtreamPendingRestoreState(state))
            );
        } catch {
            // Ignore local storage write failures.
        }
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
                JSON.stringify(currentState) !==
                    JSON.stringify(
                        normalizeXtreamPendingRestoreState(expectedState)
                    )
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
                return true;
            }
        } catch {
            // A verified tombstone is sufficient even if removal fails.
        }

        return tombstoneStored;
    }
}

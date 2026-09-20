import {
    effect,
    Signal,
    signal,
    untracked,
    WritableSignal,
} from '@angular/core';
import {
    buildCollectionViewState,
    buildOpenCollectionDetailItemState,
    COLLECTION_VIEW_STATE_KEY,
    CollectionContentType,
    CollectionScope,
    CollectionViewState,
    getCollectionViewState,
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';

/**
 * The collection's selected tab and scope live in `window.history.state`, so
 * the browser's own Back/Forward restores the view the user left instead of
 * the route defaults. This owns that one key of the current entry: reading
 * it back after a popstate, and replacing it in place while the user works.
 */
export class CollectionViewStateHistory {
    private readonly state = signal<CollectionViewState | null>(
        getCollectionViewState(window.history.state)
    );

    /** View state of the history entry currently on screen. */
    readonly current: Signal<CollectionViewState | null> =
        this.state.asReadonly();

    /** Re-read the entry — after a popstate, or on first content init. */
    refresh(): CollectionViewState | null {
        const collectionViewState = getCollectionViewState(
            window.history.state
        );
        this.state.set(collectionViewState);
        return collectionViewState;
    }

    /**
     * Replace the current entry's view state. A no-op while nothing changed,
     * so a repeated read never spends a `replaceState` on an identical value.
     */
    commit(next: CollectionViewState): void {
        const nextCollectionViewState = buildCollectionViewState(next);
        if (isSameCollectionViewState(this.state(), nextCollectionViewState)) {
            return;
        }

        const nextState = toHistoryStateRecord(window.history.state);
        if (nextCollectionViewState) {
            nextState[COLLECTION_VIEW_STATE_KEY] = nextCollectionViewState;
        } else {
            delete nextState[COLLECTION_VIEW_STATE_KEY];
        }

        window.history.replaceState(nextState, document.title);
        this.state.set(nextCollectionViewState);
    }
}

export interface CollectionViewStateSync {
    /** Apply the entry's view state to the page (popstate, first init). */
    restore(): void;
    /** Write the page's current view state before it navigates away. */
    commitCurrent(): void;
}

/**
 * Keep the history entry and the page's own view state in step: the page
 * writes every change back as it happens, and reads the entry again after
 * the browser moved to another one. Must run in an injection context.
 */
export function setupCollectionViewStateSync(options: {
    history: CollectionViewStateHistory;
    selectedContentType: WritableSignal<CollectionContentType>;
    /** `undefined` wherever the scope toggle is not offered. */
    scope: Signal<CollectionScope | undefined>;
}): CollectionViewStateSync {
    const currentViewState = (): CollectionViewState => ({
        selectedContentType: options.selectedContentType(),
        scope: options.scope(),
    });

    effect(() => {
        const state = currentViewState();
        untracked(() => options.history.commit(state));
    });

    return {
        restore(): void {
            const collectionViewState = options.history.refresh();
            if (collectionViewState?.selectedContentType) {
                options.selectedContentType.set(
                    collectionViewState.selectedContentType
                );
            }
        },
        commitCurrent(): void {
            options.history.commit(currentViewState());
        },
    };
}

/**
 * Push a history entry for an inline detail, so every way back out of it
 * (Escape, the shell's Back arrow, the browser's own Back) returns to the
 * list rather than leaving the route.
 */
export function pushOpenCollectionDetailState(
    item: UnifiedCollectionItem
): void {
    window.history.pushState(
        {
            ...toHistoryStateRecord(window.history.state),
            [OPEN_COLLECTION_DETAIL_STATE_KEY]:
                buildOpenCollectionDetailItemState(item),
        },
        document.title
    );
}

function isSameCollectionViewState(
    left: CollectionViewState | null,
    right: CollectionViewState | null
): boolean {
    return (
        left?.selectedContentType === right?.selectedContentType &&
        left?.scope === right?.scope
    );
}

function toHistoryStateRecord(state: unknown): Record<string, unknown> {
    return state && typeof state === 'object'
        ? { ...(state as Record<string, unknown>) }
        : {};
}

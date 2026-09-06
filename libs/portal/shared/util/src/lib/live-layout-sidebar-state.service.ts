import { computed, Injectable, signal } from '@angular/core';
import {
    LiveSidebarState,
    persistLiveSidebarState,
    restoreLiveSidebarState,
} from './live-sidebar-state';

/**
 * Shared visibility state for the live-TV panels across the workspace shell
 * categories rail (Xtream/Stalker), the inline channels rail, and the
 * unified-collection live tab. A single signal keeps all surfaces in sync
 * within a session; localStorage persistence is delegated to the existing
 * `live-sidebar-state` helpers so the storage key stays unchanged.
 *
 * The three states nest (see `LiveSidebarState`). Consumers read one of two
 * derived flags rather than the raw state: the categories rail folds on
 * `areCategoriesHidden`, the channels rail only on `isCollapsed`.
 */
@Injectable({ providedIn: 'root' })
export class LiveLayoutSidebarStateService {
    private readonly _state = signal<LiveSidebarState>(
        restoreLiveSidebarState()
    );
    /**
     * The level to come back to when leaving `collapsed`. Session-only on
     * purpose: after a restart the stored value already carries the answer,
     * since `collapsed` never restores.
     */
    private restoreTarget: Exclude<LiveSidebarState, 'collapsed'> =
        'expanded';

    readonly state = this._state.asReadonly();

    constructor() {
        // A stored `collapsed` restores one level up; write that back so the
        // stored value and the live state agree from the first read on.
        persistLiveSidebarState(this._state());
    }
    /** Player only: both rails are folded away. */
    readonly isCollapsed = computed(() => this._state() === 'collapsed');
    /** The categories rail is folded (`categories-hidden` or `collapsed`). */
    readonly areCategoriesHidden = computed(
        () => this._state() !== 'expanded'
    );

    /**
     * `Cmd/Ctrl+B` and the floating restore handle: leave `collapsed` for
     * the level the user collapsed from, otherwise collapse everything.
     */
    toggle(): void {
        if (this.isCollapsed()) {
            this.expand();
        } else {
            this.collapse();
        }
    }

    /** Player only. Remembers the current level for `expand()`. */
    collapse(): void {
        const current = this._state();
        if (current !== 'collapsed') {
            this.restoreTarget = current;
        }
        this.setState('collapsed');
    }

    /** Leaves `collapsed` for the level it was entered from. */
    expand(): void {
        this.setState(this.restoreTarget);
    }

    hideCategories(): void {
        this.setState('categories-hidden');
    }

    showCategories(): void {
        this.setState('expanded');
    }

    setState(state: LiveSidebarState): void {
        if (state !== 'collapsed') {
            this.restoreTarget = state;
        }
        this._state.set(state);
        persistLiveSidebarState(state);
    }
}

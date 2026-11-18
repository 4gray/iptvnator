import {
    computed,
    Injectable,
    Signal,
    signal,
    WritableSignal,
} from '@angular/core';
import { injectLiveCompactViewport } from './live-compact-viewport';
import {
    forgetLegacyLiveSidebarState,
    LiveSidebarState,
    LiveSidebarSurface,
    liveSidebarStateStorageKey,
    persistLiveSidebarState,
    restoreLiveSidebarState,
} from './live-sidebar-state';

function bySurface<T>(
    create: (surface: LiveSidebarSurface) => T
): Record<LiveSidebarSurface, T> {
    return {
        m3u: create('m3u'),
        portal: create('portal'),
        collection: create('collection'),
    };
}

/**
 * Single owner of the live-TV sidebar collapse state. Every surface that
 * renders a collapsible channel rail — the M3U player, the Xtream/Stalker
 * live layouts together with the workspace shell categories rail, the
 * unified favorites/recent live tab, and the workspace header toggle — reads
 * and writes through this service, so a toggle in one place is reflected
 * everywhere the same surface is rendered within the session.
 *
 * State is kept per surface (`live-sidebar-state:<surface>` in
 * localStorage). The pre-split shared key is forgotten on construction.
 *
 * The three levels nest (see `LiveSidebarState`). Consumers read one of two
 * derived flags rather than the raw state: the categories rail folds on
 * `areCategoriesHiddenFor(surface)`, the channels rail only on
 * `isCollapsedFor(surface)`.
 *
 * In the compact desktop band (`LIVE_COMPACT_VIEWPORT_QUERY`) the portal's
 * categories rail also folds while the stored level is `expanded`: beside
 * the rail and the channel list the player had about 117px at the 900px
 * window minimum. The fold is derived, never persisted, so widening the
 * window brings the stored level back. Asking for the rail there (the
 * popover's "show categories panel") overrides the fold until the viewport
 * leaves and re-enters the band.
 */
@Injectable({ providedIn: 'root' })
export class LiveLayoutSidebarStateService {
    private readonly states: Record<
        LiveSidebarSurface,
        WritableSignal<LiveSidebarState>
    >;
    private readonly collapsed: Record<LiveSidebarSurface, Signal<boolean>>;
    private readonly categoriesHidden: Record<
        LiveSidebarSurface,
        Signal<boolean>
    >;
    /**
     * The level to come back to when leaving `collapsed`, per surface.
     * Session-only on purpose: a restart restores the stored level itself.
     */
    private readonly restoreTargets: Record<
        LiveSidebarSurface,
        Exclude<LiveSidebarState, 'collapsed'>
    >;
    /** The user unfolded the portal rail inside the compact band. */
    private readonly compactRailRequested = signal(false);
    // Entering the band folds the rail again, whatever was asked for during
    // an earlier visit.
    private readonly compactViewport = injectLiveCompactViewport((compact) => {
        if (compact) {
            this.compactRailRequested.set(false);
        }
    });

    constructor() {
        forgetLegacyLiveSidebarState();
        this.states = bySurface((surface) =>
            signal(restoreLiveSidebarState(liveSidebarStateStorageKey(surface)))
        );
        this.collapsed = bySurface((surface) =>
            computed(() => this.states[surface]() === 'collapsed')
        );
        this.categoriesHidden = bySurface((surface) =>
            computed(
                () =>
                    this.states[surface]() !== 'expanded' ||
                    (surface === 'portal' && this.isCompactFolded())
            )
        );
        // A restored `categories-hidden` is what Cmd/Ctrl+B comes back to.
        this.restoreTargets = bySurface((surface) => {
            const restored = this.states[surface]();
            return restored === 'collapsed' ? 'expanded' : restored;
        });
    }

    stateOf(surface: LiveSidebarSurface): Signal<LiveSidebarState> {
        return this.states[surface].asReadonly();
    }

    /** Stable per-surface signal; safe to assign to a component field. */
    isCollapsedFor(surface: LiveSidebarSurface): Signal<boolean> {
        return this.collapsed[surface];
    }

    /**
     * The categories rail is folded (`categories-hidden` or `collapsed`).
     * Stable per-surface signal.
     */
    areCategoriesHiddenFor(surface: LiveSidebarSurface): Signal<boolean> {
        return this.categoriesHidden[surface];
    }

    /**
     * `Cmd/Ctrl+B`, the header toggle and the floating restore handle: leave
     * `collapsed` for the level the user collapsed from, otherwise collapse
     * everything.
     */
    toggle(surface: LiveSidebarSurface): void {
        if (this.collapsed[surface]()) {
            this.expand(surface);
        } else {
            this.collapse(surface);
        }
    }

    /** Player only. Remembers the current level for `expand()`. */
    collapse(surface: LiveSidebarSurface): void {
        this.setState(surface, 'collapsed');
    }

    /** Leaves `collapsed` for the level it was entered from. */
    expand(surface: LiveSidebarSurface): void {
        this.setState(surface, this.restoreTargets[surface]);
    }

    hideCategories(surface: LiveSidebarSurface): void {
        if (surface === 'portal') {
            this.compactRailRequested.set(false);
        }
        this.setState(surface, 'categories-hidden');
    }

    showCategories(surface: LiveSidebarSurface): void {
        if (surface === 'portal' && this.compactViewport()) {
            this.compactRailRequested.set(true);
        }
        this.setState(surface, 'expanded');
    }

    private isCompactFolded(): boolean {
        return this.compactViewport() && !this.compactRailRequested();
    }

    setState(surface: LiveSidebarSurface, state: LiveSidebarState): void {
        if (state !== 'collapsed') {
            this.restoreTargets[surface] = state;
        }
        this.states[surface].set(state);
        persistLiveSidebarState(state, liveSidebarStateStorageKey(surface));
    }
}

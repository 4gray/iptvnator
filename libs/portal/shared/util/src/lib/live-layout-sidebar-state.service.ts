import {
    computed,
    Injectable,
    Signal,
    signal,
    WritableSignal,
} from '@angular/core';
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
 */
@Injectable({ providedIn: 'root' })
export class LiveLayoutSidebarStateService {
    private readonly states: Record<
        LiveSidebarSurface,
        WritableSignal<LiveSidebarState>
    >;
    private readonly collapsed: Record<LiveSidebarSurface, Signal<boolean>>;

    constructor() {
        forgetLegacyLiveSidebarState();
        this.states = bySurface((surface) =>
            signal(restoreLiveSidebarState(liveSidebarStateStorageKey(surface)))
        );
        this.collapsed = bySurface((surface) =>
            computed(() => this.states[surface]() === 'collapsed')
        );
    }

    stateOf(surface: LiveSidebarSurface): Signal<LiveSidebarState> {
        return this.states[surface].asReadonly();
    }

    /** Stable per-surface signal; safe to assign to a component field. */
    isCollapsedFor(surface: LiveSidebarSurface): Signal<boolean> {
        return this.collapsed[surface];
    }

    toggle(surface: LiveSidebarSurface): void {
        this.setState(
            surface,
            this.collapsed[surface]() ? 'expanded' : 'collapsed'
        );
    }

    setState(surface: LiveSidebarSurface, state: LiveSidebarState): void {
        this.states[surface].set(state);
        persistLiveSidebarState(state, liveSidebarStateStorageKey(surface));
    }
}

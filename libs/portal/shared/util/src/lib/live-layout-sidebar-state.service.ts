import { computed, Injectable, signal } from '@angular/core';
import {
    LiveSidebarState,
    persistLiveSidebarState,
    restoreLiveSidebarState,
} from './live-sidebar-state';

/**
 * @deprecated Migrate consumers to `LiveLayoutPanelStateService` from
 * `@iptvnator/portal/shared/data-access`. This compatibility service remains
 * until every existing live layout has moved in the current change.
 */
@Injectable({ providedIn: 'root' })
export class LiveLayoutSidebarStateService {
    private readonly _state = signal<LiveSidebarState>(
        restoreLiveSidebarState()
    );
    readonly state = this._state.asReadonly();
    readonly isCollapsed = computed(() => this._state() === 'collapsed');

    toggle(): void {
        this.setState(this.isCollapsed() ? 'expanded' : 'collapsed');
    }

    setState(state: LiveSidebarState): void {
        this._state.set(state);
        persistLiveSidebarState(state);
    }
}

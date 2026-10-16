import {
    computed,
    inject,
    linkedSignal,
    Signal,
    WritableSignal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
    CollectionScope,
    queryParamSignal,
    ScopeToggleService,
} from '@iptvnator/portal/shared/util';

export interface CollectionScopeState {
    /** The toggle's value, even where the toggle itself is not offered. */
    readonly scope: WritableSignal<CollectionScope>;
    /** Only a playlist-bound collection can narrow to one playlist. */
    readonly showToggle: Signal<boolean>;
    /** The scope to load with: `all` wherever the toggle is absent. */
    readonly effective: Signal<CollectionScope>;
    /** The user picked a scope; remember it for the next visit. */
    select(value: CollectionScope): void;
}

/**
 * "This playlist" vs "All playlists" for a collection. The value is taken
 * from the first source that states one — the `scope` query param, the
 * history entry the user came back to, the route's own default — and falls
 * back to what this collection was last left on. Must run in an injection
 * context (the hosting component's field initializer or constructor).
 */
export function createCollectionScopeState(options: {
    /** Keys the persisted scope: favorites and recent are remembered apart. */
    scopeKey: Signal<string>;
    playlistId: Signal<string | undefined>;
    defaultScope: Signal<CollectionScope | undefined>;
    historyScope: Signal<CollectionScope | undefined>;
}): CollectionScopeState {
    const route = inject(ActivatedRoute);
    const scopeService = inject(ScopeToggleService);
    const queryScope = queryParamSignal<CollectionScope | null>(
        route,
        'scope',
        (value) => (value === 'all' || value === 'playlist' ? value : null)
    );
    const persistedScope = computed(() =>
        scopeService.getScope(options.scopeKey())()
    );
    const showToggle = computed(() => Boolean(options.playlistId()));

    const scope = linkedSignal<CollectionScope>(() => {
        if (!showToggle()) {
            return 'all';
        }

        return (
            queryScope() ??
            options.historyScope() ??
            options.defaultScope() ??
            persistedScope()
        );
    });

    return {
        scope,
        showToggle,
        effective: computed(() => (showToggle() ? scope() : 'all')),
        select(value: CollectionScope): void {
            if (!showToggle()) {
                return;
            }

            scope.set(value);
            scopeService.setScope(options.scopeKey(), value);
        },
    };
}

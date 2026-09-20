import { computed, Signal, signal } from '@angular/core';
import {
    FavoritesChannelSortMode,
    getFavoritesChannelSortModeTranslationKey,
    persistFavoritesChannelSortMode,
    restoreFavoritesChannelSortMode,
} from '@iptvnator/portal/shared/util';

export interface FavoritesSortOption {
    readonly mode: FavoritesChannelSortMode;
    readonly translationKey: string;
    readonly icon: string;
}

export const FAVORITES_SORT_OPTIONS: readonly FavoritesSortOption[] = [
    {
        mode: 'custom',
        translationKey: 'WORKSPACE.SORT_CUSTOM',
        icon: 'drag_indicator',
    },
    {
        mode: 'name-asc',
        translationKey: 'WORKSPACE.SORT_NAME_ASC',
        icon: 'sort_by_alpha',
    },
    {
        mode: 'name-desc',
        translationKey: 'WORKSPACE.SORT_NAME_DESC',
        icon: 'sort_by_alpha',
    },
    {
        mode: 'date-desc',
        translationKey: 'WORKSPACE.SORT_DATE_DESC',
        icon: 'schedule',
    },
];

export interface FavoritesSortState {
    readonly mode: Signal<FavoritesChannelSortMode>;
    readonly labelKey: Signal<string>;
    readonly options: readonly FavoritesSortOption[];
    setMode(mode: FavoritesChannelSortMode): void;
}

/**
 * Sort order of the favorites live rail. The choice is global rather than
 * per collection, so it is restored from — and written straight back to —
 * the shared persisted value.
 */
export function createFavoritesSortState(): FavoritesSortState {
    const mode = signal<FavoritesChannelSortMode>(
        restoreFavoritesChannelSortMode()
    );

    return {
        mode: mode.asReadonly(),
        labelKey: computed(() =>
            getFavoritesChannelSortModeTranslationKey(mode())
        ),
        options: FAVORITES_SORT_OPTIONS,
        setMode(next: FavoritesChannelSortMode): void {
            mode.set(next);
            persistFavoritesChannelSortMode(next);
        },
    };
}

import { computed, Signal } from '@angular/core';
import { CollectionMode } from '@iptvnator/portal/shared/data-access';

export interface CollectionModeLabels {
    readonly title: Signal<string>;
    readonly clearTooltipKey: Signal<string>;
    readonly emptyStateIcon: Signal<string>;
    readonly emptyStateTitleKey: Signal<string>;
    readonly emptyStateBodyKey: Signal<string>;
}

/**
 * The copy a unified collection page shows for its mode. Favorites and
 * recently viewed share every control, so only these strings differ.
 */
export function createCollectionModeLabels(
    mode: Signal<CollectionMode>
): CollectionModeLabels {
    const byMode = <T>(favorites: T, recent: T): Signal<T> =>
        computed(() => (mode() === 'favorites' ? favorites : recent));

    return {
        title: byMode('PORTALS.FAVORITES', 'PORTALS.RECENTLY_VIEWED'),
        clearTooltipKey: byMode(
            'WORKSPACE.SHELL.CLEAR_FAVORITES_TYPE',
            'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_TYPE'
        ),
        emptyStateIcon: byMode('favorite_border', 'history_toggle_off'),
        emptyStateTitleKey: byMode(
            'WORKSPACE.GLOBAL_FAVORITES.NO_ITEMS_TITLE',
            'WORKSPACE.GLOBAL_RECENT.NO_ITEMS_TITLE'
        ),
        emptyStateBodyKey: byMode(
            'WORKSPACE.GLOBAL_FAVORITES.NO_ITEMS_BODY',
            'WORKSPACE.GLOBAL_RECENT.NO_ITEMS_BODY'
        ),
    };
}

/**
 * Confirmation copy for "clear the current tab". The message names what the
 * action reaches: the playlist scope removes this playlist's rows, the
 * global one every playlist's.
 */
export function resolveClearCollectionDialogKeys(
    mode: CollectionMode,
    isPlaylistScope: boolean
): { titleKey: string; messageKey: string } {
    if (mode === 'favorites') {
        return {
            titleKey: 'WORKSPACE.SHELL.CLEAR_FAVORITES_DIALOG_TITLE',
            messageKey: isPlaylistScope
                ? 'WORKSPACE.SHELL.CLEAR_FAVORITES_DIALOG_MESSAGE_PLAYLIST'
                : 'WORKSPACE.SHELL.CLEAR_FAVORITES_DIALOG_MESSAGE_ALL',
        };
    }

    return {
        titleKey: 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_TITLE',
        messageKey: isPlaylistScope
            ? 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_MESSAGE_PLAYLIST'
            : 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_MESSAGE_ALL',
    };
}

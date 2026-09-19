import {
    computed,
    effect,
    EffectRef,
    inject,
    Signal,
    untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import {
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { CollectionScope } from '@iptvnator/portal/shared/util';
import {
    CollectionLoadRequest,
    CollectionMode,
} from './unified-collection-data.service';

/**
 * Re-load the collection whenever what it should contain changes: its mode,
 * the playlist or scope it is bound to, and — for favorites — the playlist
 * rows themselves, since a heart toggled anywhere else in the app lands
 * there rather than in this page's state.
 *
 * Must run in an injection context (the hosting component's field
 * initializer or constructor).
 */
export function setupCollectionLoad(options: {
    mode: Signal<CollectionMode>;
    portalType: Signal<string | undefined>;
    playlistId: Signal<string | undefined>;
    scope: Signal<CollectionScope>;
    load: (request: CollectionLoadRequest & { mode: CollectionMode }) => void;
}): EffectRef {
    const store = inject(Store);
    const playlists = store.selectSignal(selectAllPlaylistsMeta);
    const playlistsLoaded = store.selectSignal(selectPlaylistsLoadingFlag);

    const favoritesReloadKey = computed(() => {
        if (options.mode() !== 'favorites') {
            return 'recent';
        }

        if (!playlistsLoaded()) {
            return null;
        }

        return playlists()
            .map((playlist) =>
                [
                    playlist._id,
                    playlist.serverUrl
                        ? 'xtream'
                        : playlist.macAddress
                          ? 'stalker'
                          : 'm3u',
                    JSON.stringify(playlist.favorites ?? []),
                ].join('::')
            )
            .join('|');
    });

    const loadRequest = computed(() => ({
        mode: options.mode(),
        portalType: options.portalType(),
        playlistId: options.playlistId(),
        scope: options.scope(),
        reloadKey: favoritesReloadKey(),
    }));

    return effect(() => {
        const { mode, portalType, playlistId, scope } = loadRequest();
        untracked(() => {
            options.load({ mode, portalType, playlistId, scope });
        });
    });
}

import { computed, type Signal } from '@angular/core';
import type {
    MultiviewAnchorHost,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const PORTAL_INLINE_PLAYER_ANCHOR_ID = 'portal-inline-player';

export interface PortalInlinePlayerMultiviewDeps {
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly sessionKey: Signal<string>;
    readonly isEpisode: () => boolean;
    readonly engine: () => VideoPlayer | null | undefined;
    /** The host's own progress saving: the player's `timeUpdate` output. */
    readonly persistPosition: (event: {
        readonly currentTime: number;
        readonly duration: number;
    }) => void;
}

/**
 * The detail pages' inline player (movies, episodes, collections) as a
 * multiview anchor. Tile 1 keeps saving its progress through the page that
 * opened it (R9). The player cannot switch to another title by itself, so a
 * survivor other than its own title is not adopted here.
 */
export function createPortalInlinePlayerMultiviewHost(
    deps: PortalInlinePlayerMultiviewDeps
): MultiviewAnchorHost {
    const source = computed<MultiviewTileSource | null>(() => {
        const playback = deps.playback();
        const sessionKey = deps.sessionKey();
        if (!playback?.streamUrl || !sessionKey) return null;
        return {
            playback,
            playbackSessionKey: sessionKey,
            kind: playback.isLive
                ? 'live'
                : deps.isEpisode()
                  ? 'episode'
                  : 'vod',
            playlistId: playback.contentInfo?.playlistId ?? '',
            title: playback.title,
            persistPosition: deps.persistPosition,
        };
    });

    return {
        anchorId: PORTAL_INLINE_PLAYER_ANCHOR_ID,
        source,
        engine: computed(() => deps.engine() ?? VideoPlayer.VideoJs),
    };
}

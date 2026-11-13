import { computed, signal, type Signal } from '@angular/core';
import { createInlinePlaybackPositionWriter } from '@iptvnator/portal/shared/util';
import type {
    MultiviewAnchorHost,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import {
    type PlaybackPositionData,
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const PORTAL_INLINE_PLAYER_ANCHOR_ID = 'portal-inline-player';

export interface PortalInlinePlayerMultiviewDeps {
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly sessionKey: Signal<string>;
    readonly isEpisode: () => boolean;
    readonly engine: () => VideoPlayer | null | undefined;
    /** The player's volume, so tile 1 does not jump to full volume. */
    readonly volume?: () => number;
    /** The host's own progress saving: the player's `timeUpdate` output. */
    readonly persistPosition: (event: {
        readonly currentTime: number;
        readonly duration: number;
    }) => void;
    /**
     * Saves a position directly, for a tile whose title the page no longer
     * shows (the viewer picked another episode meanwhile).
     */
    readonly savePosition: (
        playlistId: string,
        position: PlaybackPositionData
    ) => void;
}

/**
 * The detail pages' inline player (movies, episodes, collections) as a
 * multiview anchor. Tile 1 keeps saving its progress through the page that
 * opened it (R9). The player cannot switch to another title by itself, so a
 * survivor other than its own title is not adopted here.
 */
/**
 * R9 with the right identity: while the page still shows this title, its
 * own handler saves (and tracks) the progress; once the page moved to
 * another title, a writer bound to this playback saves it instead.
 */
function boundProgress(
    deps: PortalInlinePlayerMultiviewDeps,
    playback: ResolvedPortalPlayback
): MultiviewTileSource['persistPosition'] {
    const writer = createInlinePlaybackPositionWriter({
        playback: signal<ResolvedPortalPlayback | null>(playback),
        save: deps.savePosition,
    });
    return (event) => {
        if (deps.playback() === playback) deps.persistPosition(event);
        else writer.handleTimeUpdate(event);
    };
}

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
            persistPosition: boundProgress(deps, playback),
            ...(deps.volume ? { volume: deps.volume() } : {}),
        };
    });

    return {
        anchorId: PORTAL_INLINE_PLAYER_ANCHOR_ID,
        source,
        engine: computed(() => deps.engine() ?? VideoPlayer.VideoJs),
    };
}

import { computed, type Signal } from '@angular/core';
import type {
    MultiviewAnchorHost,
    MultiviewTile,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import {
    type Channel,
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const M3U_PLAYER_ANCHOR_ID = 'm3u-player';

export interface M3uMultiviewDeps {
    readonly playlistId: Signal<string | null | undefined>;
    readonly channel: Signal<Channel | null | undefined>;
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly sessionKey: Signal<string>;
    /** Resolved catch-up URL while a programme from the archive plays. */
    readonly catchupUrl: Signal<string | null | undefined>;
    /** Engine the inline player uses (DASH forces its own). */
    readonly engine: () => VideoPlayer | null | undefined;
    /** Makes a channel of the current playlist the active one. */
    /** Selects the channel; false when the view does not list it. */
    readonly selectChannel: (channelId: string) => boolean;
}

/**
 * The M3U player as a multiview anchor. A catch-up programme is its own
 * source (held paused without audio like a VOD) and cannot be re-selected
 * as a plain channel when it survives a session.
 */
export function createM3uMultiviewHost(
    deps: M3uMultiviewDeps
): MultiviewAnchorHost {
    const source = computed<MultiviewTileSource | null>(() => {
        const playback = deps.playback();
        const sessionKey = deps.sessionKey();
        const playlistId = deps.playlistId();
        const channel = deps.channel();
        if (!playback?.streamUrl || !sessionKey || !playlistId || !channel) {
            return null;
        }
        const catchupUrl = deps.catchupUrl();
        return {
            playback,
            playbackSessionKey: catchupUrl
                ? `${sessionKey}|catchup:${catchupUrl}`
                : sessionKey,
            kind: playback.isLive === false ? 'vod' : 'live',
            playlistId,
            contentId: catchupUrl ? undefined : String(channel.id),
            title: playback.title,
            // Radio plays in the audio player and never becomes a tile.
            ...(channel.radio === 'true' ? { radio: true } : {}),
        };
    });

    return {
        anchorId: M3U_PLAYER_ANCHOR_ID,
        source,
        engine: computed(() => deps.engine() ?? VideoPlayer.VideoJs),
        adopt(tile: MultiviewTile): boolean {
            if (!tile.contentId || tile.playlistId !== deps.playlistId()) {
                return false;
            }
            return deps.selectChannel(tile.contentId);
        },
    };
}

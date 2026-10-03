import type {
    PortalExternalPlayback,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type {
    ExternalPlayerName,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { closeRunningExternalSession } from '../vod-details/vod-details-external-session';

/** What a forced MPV/VLC episode launch reads from the series page. */
export interface SeriesExternalLaunchHost {
    readonly portalPlayer: Pick<PortalPlayer, 'openExternalPlayback'>;
    readonly externalPlayback: Pick<
        PortalExternalPlayback,
        'activeSession' | 'closeSession'
    >;
    currentPlaylistId(): string;
    selectedItem(): { series_id?: string | number } | null;
}

/**
 * The "…" menu's MPV/VLC launch of an episode. An episode of this series
 * still running externally is closed first: with instance reuse off a
 * second detached player would start beside it. When that close fails the
 * running player stays and nothing new launches.
 */
export async function openEpisodeExternally(
    host: SeriesExternalLaunchHost,
    playback: ResolvedPortalPlayback,
    player: ExternalPlayerName
): Promise<ExternalPlayerSession | void> {
    const session = host.externalPlayback.activeSession();
    const info = session?.contentInfo;
    const ownSession =
        session &&
        info &&
        session.status !== 'closed' &&
        info.contentType === 'episode' &&
        info.playlistId === host.currentPlaylistId() &&
        info.seriesXtreamId === Number(host.selectedItem()?.series_id ?? 0)
            ? session
            : null;
    const replaced = await closeRunningExternalSession(
        ownSession,
        (running) => host.externalPlayback.closeSession(running),
        (message, error) =>
            console.warn(`[SerialDetailsPlayback] ${message}`, error)
    );
    if (!replaced) {
        return;
    }
    return host.portalPlayer.openExternalPlayback(playback, player);
}

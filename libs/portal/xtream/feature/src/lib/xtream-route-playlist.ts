import type { XtreamPlaylistData } from '@iptvnator/portal/xtream/data-access';
import { normalizeXtreamContentTypes, type PlaylistMeta } from '@iptvnator/shared/interfaces';

function normalizeOptionalConnectionValue(
    value: string | null | undefined
): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

export function toXtreamPlaylistData(
    playlist: PlaylistMeta | null
): XtreamPlaylistData | null {
    if (
        !playlist?._id ||
        !playlist.serverUrl ||
        !playlist.username ||
        !playlist.password
    ) {
        return null;
    }

    const userAgent = normalizeOptionalConnectionValue(playlist.userAgent);
    const referrer = normalizeOptionalConnectionValue(playlist.referrer);
    const origin = normalizeOptionalConnectionValue(playlist.origin);

    return {
        id: playlist._id,
        name: playlist.title || playlist.filename || 'Untitled playlist',
        title: playlist.title,
        updateDate: playlist.updateDate,
        xtreamContentTypes: playlist.xtreamContentTypes,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        type: 'xtream',
        ...(userAgent ? { userAgent } : {}),
        ...(referrer ? { referrer } : {}),
        ...(origin ? { origin } : {}),
        ...(playlist.serverTimezone
            ? { serverTimezone: playlist.serverTimezone }
            : {}),
    };
}

function hasPlaylistConnectionChanges(
    currentPlaylist: XtreamPlaylistData | null,
    nextPlaylist: XtreamPlaylistData | null
): boolean {
    if (!currentPlaylist || !nextPlaylist) {
        return false;
    }

    const currentUserAgent = normalizeOptionalConnectionValue(
        currentPlaylist.userAgent
    );
    const nextUserAgent = normalizeOptionalConnectionValue(
        nextPlaylist.userAgent
    );
    const currentReferrer = normalizeOptionalConnectionValue(
        currentPlaylist.referrer
    );
    const nextReferrer = normalizeOptionalConnectionValue(
        nextPlaylist.referrer
    );
    const currentOrigin = normalizeOptionalConnectionValue(
        currentPlaylist.origin
    );
    const nextOrigin = normalizeOptionalConnectionValue(nextPlaylist.origin);

    return (
        currentPlaylist.serverUrl !== nextPlaylist.serverUrl ||
        currentPlaylist.username !== nextPlaylist.username ||
        currentPlaylist.password !== nextPlaylist.password ||
        currentUserAgent !== nextUserAgent ||
        currentReferrer !== nextReferrer ||
        currentOrigin !== nextOrigin ||
        JSON.stringify(normalizeXtreamContentTypes(currentPlaylist.xtreamContentTypes)) !==
            JSON.stringify(normalizeXtreamContentTypes(nextPlaylist.xtreamContentTypes))
    );
}

export function shouldBootstrapXtreamPlaylist(
    playlistId: string | null,
    routePlaylist: XtreamPlaylistData | null,
    storePlaylistId: string | null,
    currentPlaylist: XtreamPlaylistData | null
): boolean {
    const currentPlaylistUpdateDate = currentPlaylist?.updateDate ?? null;
    const routePlaylistUpdateDate = routePlaylist?.updateDate ?? null;

    return Boolean(
        playlistId &&
        routePlaylist &&
        (storePlaylistId !== playlistId ||
            currentPlaylist?.id !== playlistId ||
            currentPlaylistUpdateDate !== routePlaylistUpdateDate ||
            hasPlaylistConnectionChanges(currentPlaylist, routePlaylist))
    );
}

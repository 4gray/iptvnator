import type { XtreamPlaylistData } from '@iptvnator/portal/xtream/data-access';

export type XtreamLiveOwner = Pick<
    XtreamPlaylistData,
    'serverUrl' | 'username' | 'password'
> & {
    playlistId: string;
};

export function captureXtreamLiveOwner(
    playlist?: XtreamPlaylistData | null
): XtreamLiveOwner | undefined {
    if (!playlist?.id) return undefined;
    const { id: playlistId, serverUrl, username, password } = playlist;
    return { playlistId, serverUrl, username, password };
}

export function sameXtreamLiveOwner(
    left: XtreamLiveOwner | undefined,
    right: XtreamLiveOwner | undefined
): boolean {
    return (
        !!left &&
        !!right &&
        left.playlistId === right.playlistId &&
        left.serverUrl === right.serverUrl &&
        left.username === right.username &&
        left.password === right.password
    );
}

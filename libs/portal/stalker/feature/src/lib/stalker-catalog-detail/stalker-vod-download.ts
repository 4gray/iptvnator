import type { DownloadsService } from '@iptvnator/services';
import type { VodDetailsItem } from '@iptvnator/shared/interfaces';

/** The Stalker branch of the item union — the only one carrying `cmd`. */
type StalkerVodDetailsItem = Extract<VodDetailsItem, { type: 'stalker' }>;
import {
    normalizeStalkerEntityId,
    normalizeStalkerEntityIdAsNumber,
} from '@iptvnator/portal/stalker/data-access';

/**
 * Starting a download of a Stalker VOD item.
 *
 * Split out of the detail component because it is a self-contained errand: it
 * resolves a playable link (Stalker hands out `create_link` URLs, not static
 * ones) and hands the result to the download manager. Nothing else in the
 * component needs it.
 */

/** The provider payload carried on a Stalker VOD item. */
export interface DownloadVodData {
    id?: string | number;
    has_files?: unknown;
    title?: string;
    info?: { name?: string; movie_image?: string };
}

export interface StalkerVodDownloadPlaylist {
    id: string;
    portalUrl?: string;
    macAddress?: string;
    title?: string;
    userAgent?: string;
    referer?: string;
    origin?: string;
}

export interface StalkerVodDownloadDeps {
    playlist: StalkerVodDownloadPlaylist | null | undefined;
    downloadsService: Pick<DownloadsService, 'startDownload'>;
    fetchMovieFileId: (id: string) => Promise<string | number | null>;
    fetchLinkToPlay: (
        portalUrl: string,
        macAddress: string,
        cmd: string
    ) => Promise<string | null>;
}

export async function startStalkerVodDownload(
    item: VodDetailsItem,
    deps: StalkerVodDownloadDeps
): Promise<void> {
    if (item.type !== 'stalker') {
        return;
    }

    const { playlist } = deps;
    if (!playlist?.portalUrl || !playlist.macAddress) {
        return;
    }

    const itemData = item.data as DownloadVodData;
    const cmdToUse = await resolveDownloadCmd(item, itemData, deps);

    const url = await deps.fetchLinkToPlay(
        playlist.portalUrl,
        playlist.macAddress,
        cmdToUse
    );
    if (!url) {
        return;
    }

    await deps.downloadsService.startDownload({
        playlistId: playlist.id,
        xtreamId: normalizeStalkerEntityIdAsNumber(itemData?.id) ?? 0,
        contentType: 'vod',
        title: itemData?.info?.name || itemData?.title || 'Unknown',
        url,
        posterUrl: itemData?.info?.movie_image,
        headers: {
            userAgent: playlist.userAgent,
            referer: playlist.referer,
            origin: playlist.origin,
        },
        playlistName: playlist.title || 'Stalker Portal',
        playlistType: 'stalker',
        portalUrl: playlist.portalUrl,
        macAddress: playlist.macAddress,
    });
}

/**
 * Ministra portals expose a movie as a folder command that has to be turned
 * into a concrete file command before it can be linked.
 */
async function resolveDownloadCmd(
    item: StalkerVodDetailsItem,
    itemData: DownloadVodData,
    deps: StalkerVodDownloadDeps
): Promise<string> {
    const cmd = item.cmd ?? '';
    const needsFileId =
        itemData?.has_files !== undefined &&
        cmd &&
        !cmd.includes('://') &&
        cmd.includes('/media/') &&
        !cmd.includes('/media/file_');

    if (!needsFileId) {
        return cmd;
    }

    const fileId = await deps.fetchMovieFileId(
        normalizeStalkerEntityId(itemData?.id)
    );
    return fileId ? `/media/file_${fileId}.mpg` : cmd;
}

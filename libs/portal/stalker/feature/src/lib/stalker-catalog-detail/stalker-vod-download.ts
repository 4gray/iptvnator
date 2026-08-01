import type { DownloadsService } from '@iptvnator/services';
import { createMovieDownloadSnapshot } from '@iptvnator/portal/shared/util';
import type {
    TmdbEnrichedCastMember,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';

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
    category_id?: string | number;
    info?: {
        name?: string;
        o_name?: string;
        description?: string;
        movie_image?: string;
        tmdb_backdrop?: string;
        releasedate?: string;
        genre?: string;
        rating_imdb?: string | number;
        tmdb_id?: string | number;
        tmdb_cast?: TmdbEnrichedCastMember[];
        tmdb_directors?: TmdbEnrichedCastMember[];
        actors?: string;
        director?: string;
    };
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
    language?: string;
}

function textList(value: string | undefined): string[] | undefined {
    const entries = value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries?.length ? entries : undefined;
}

function number(value: string | number | undefined): number | undefined {
    if (value === undefined || String(value).trim() === '') {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function year(value: string | undefined): number | undefined {
    const match = value?.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    return match ? Number(match[1]) : undefined;
}

function firstText(...values: (string | undefined)[]): string | undefined {
    return values.map((value) => value?.trim()).find(Boolean);
}

function people(
    enriched: TmdbEnrichedCastMember[] | undefined,
    fallback: string | undefined
) {
    return enriched?.length
        ? enriched.map((person) => ({
              name: person.name,
              role: person.character,
              profileUrl: person.profileUrl ?? undefined,
              tmdbPersonId: person.tmdbPersonId,
          }))
        : textList(fallback)?.map((name) => ({ name }));
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
    const downloadTitle = itemData?.info?.name || itemData?.title || 'Unknown';
    const snapshotTitle =
        firstText(itemData?.info?.name, itemData?.title) ?? 'Unknown';
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
        title: downloadTitle,
        url,
        posterUrl: itemData?.info?.movie_image,
        metadataSnapshot: createMovieDownloadSnapshot({
            language: deps.language?.trim() || 'en',
            title: snapshotTitle,
            originalTitle: itemData.info?.o_name,
            plot: itemData.info?.description,
            releaseDate: itemData.info?.releasedate,
            year: year(itemData.info?.releasedate),
            genres: textList(itemData.info?.genre),
            rating: number(itemData.info?.rating_imdb),
            posterUrl: itemData.info?.movie_image,
            backdropUrl: itemData.info?.tmdb_backdrop,
            tmdbId: number(itemData.info?.tmdb_id),
            providerCategoryId:
                itemData.category_id === undefined
                    ? undefined
                    : String(itemData.category_id),
            cast: people(itemData.info?.tmdb_cast, itemData.info?.actors),
            creators: people(
                itemData.info?.tmdb_directors,
                itemData.info?.director
            ),
        }),
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

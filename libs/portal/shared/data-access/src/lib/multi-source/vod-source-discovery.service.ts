import { Injectable } from '@angular/core';
import type {
    VodSourceCandidate,
    VodSourceCandidateRow,
    VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';
import { parseTitleMetadata } from './vod-source-metadata.util';

/**
 * Finds the same movie in the user's other playlists.
 *
 * Electron-only, and deliberately lazy: it runs when a detail page opens, not
 * as a background index. Discovery returns rows the `content` table can prove
 * — title, ids, poster — and NOTHING about container, codec or audio, because
 * those columns do not exist. Everything a row shows at this stage is either a
 * hard id or a guess parsed off the title and marked as one.
 */

export interface VodSourceDiscoveryRequest {
    title: string;
    year?: number | null;
    /** The playlist being viewed; never offered back as an alternative. */
    currentPlaylistId: string;
}

export interface VodSourceDiscoveryResult {
    sources: VodSourceCandidate[];
    /**
     * How the set was matched. v1 matches on normalized title + year — a TMDB
     * id is not stored in the `content` table, so it cannot drive the SQL.
     */
    matchKind: VodSourceMatchKind;
}

@Injectable({ providedIn: 'root' })
export class VodSourceDiscoveryService {
    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.dbFindTitleSources === 'function'
        );
    }

    async discover(
        request: VodSourceDiscoveryRequest
    ): Promise<VodSourceDiscoveryResult> {
        const empty: VodSourceDiscoveryResult = {
            sources: [],
            matchKind: 'title-year',
        };

        if (!this.isAvailable || !request.title?.trim()) {
            return empty;
        }

        try {
            const rows = await window.electron.dbFindTitleSources({
                title: request.title,
                year: request.year ?? null,
                excludePlaylistId: request.currentPlaylistId,
            });

            return {
                sources: (rows ?? []).map(toCandidate),
                matchKind: 'title-year',
            };
        } catch (error) {
            console.warn('VOD source discovery failed:', error);
            return empty;
        }
    }
}

function toCandidate(row: VodSourceCandidateRow): VodSourceCandidate {
    // Everything inferable at this point comes from the title string, so it is
    // all `provenance: 'parsed'`. Facts arrive later, from `get_vod_info`.
    const parsed = parseTitleMetadata(row.title);

    return {
        id: `${row.playlistId}:xtream:${row.xtreamId}`,
        playlistId: row.playlistId,
        playlistName: row.playlistName,
        portalType: 'xtream',
        contentId: row.xtreamId,
        rawTitle: row.title,
        matchConfidence: row.matchConfidence,
        year: row.year,
        posterUrl: row.posterUrl,
        quality: parsed.quality,
        codec: parsed.codec,
        audio: parsed.audio,
    };
}

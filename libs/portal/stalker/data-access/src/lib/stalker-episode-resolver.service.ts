import { inject, Injectable } from '@angular/core';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerMappedEpisode } from './stalker-series.adapters';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { executeStalkerRequest } from './stores/utils/stalker-request.utils';
import { fetchStalkerPlaybackLink } from './stores/utils/stalker-player-request.utils';

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function command(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Resolves provider episode rows without treating their IDs as media-file IDs. */
@Injectable({ providedIn: 'root' })
export class StalkerEpisodeResolver {
    private readonly deps = {
        dataService: inject(DataService),
        stalkerSession: inject(StalkerSessionService),
        portalRepair: inject(StalkerPortalRepairService),
    };

    async resolveCommand(
        playlist: PlaylistMeta | undefined | null,
        episode: StalkerMappedEpisode
    ): Promise<string> {
        if (!playlist?.portalUrl || !playlist.macAddress) {
            throw new Error('nothing_to_play');
        }
        // Some panels supply the episode's own playable command directly.
        // This is deliberately never the parent show's saved command.
        const ownCommand = command(episode.originalCmd);
        if (ownCommand) return ownCommand;

        const coordinates = episode.vodEpisode;
        if (
            episode.custom_sid !== 'vod-series' ||
            !coordinates ||
            !Object.values(coordinates).every((id) => id.trim())
        ) {
            throw new Error('nothing_to_play');
        }
        const response = await executeStalkerRequest<unknown>(
            this.deps,
            playlist,
            {
                action: 'get_ordered_list',
                type: 'vod',
                movie_id: coordinates.movieId,
                season_id: coordinates.seasonId,
                episode_id: coordinates.episodeId,
                p: '1',
            }
        );
        const js = object(response)?.['js'];
        const envelope = object(js);
        const rows = Array.isArray(js) ? js : envelope?.['data'];
        if (envelope?.['error'] || !Array.isArray(rows)) {
            throw new Error('nothing_to_play');
        }
        // Keep provider ordering among video variants (quality/language).
        // Never substitute the episode ID or parent command for a missing file.
        for (const value of rows) {
            const file = object(value);
            if (
                !file ||
                ![true, 1, '1'].some((flag) => flag === file['is_file'])
            ) {
                continue;
            }
            if (file['file_type'] != null && file['file_type'] !== 'video')
                continue;
            if (
                file['video_id'] != null &&
                String(file['video_id']) !== coordinates.movieId
            )
                continue;
            if (
                file['series_id'] != null &&
                String(file['series_id']) !== coordinates.episodeId
            )
                continue;
            const cmd = command(file['cmd']);
            if (cmd) return cmd;
        }
        throw new Error('nothing_to_play');
    }

    async resolveDownload(
        playlist: PlaylistMeta | undefined | null,
        episode: StalkerMappedEpisode
    ): Promise<string> {
        if (!playlist) throw new Error('nothing_to_play');
        const cmd = await this.resolveCommand(playlist, episode);
        return fetchStalkerPlaybackLink(this.deps, {
            playlist,
            selectedContentType: 'vod',
            cmd,
            series: episode.episode_num,
        });
    }
}

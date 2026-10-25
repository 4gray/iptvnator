import { inject, Injectable } from '@angular/core';
import { resolveStalkerEpisodeCommand } from './stalker-episode-command';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerMappedEpisode } from './stalker-series.adapters';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { executeStalkerRequest } from './stores/utils/stalker-request.utils';
import { fetchStalkerPlaybackLink } from './stores/utils/stalker-player-request.utils';

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
        return resolveStalkerEpisodeCommand(episode, (params) =>
            executeStalkerRequest<unknown>(this.deps, playlist, params)
        );
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

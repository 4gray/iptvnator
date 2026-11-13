import { Injectable, inject } from '@angular/core';
import type {
    MultiviewConnectionBudget,
    MultiviewConnectionBudgetSource,
} from '@iptvnator/playback/multiview/data-access';
import { sourceSortName } from '@iptvnator/playlist/shared/util';
import { XtreamApiService } from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import { connectionBudgetFromUserInfo } from './connection-budget';

/**
 * Connection budget of a playlist (spec 12). Xtream panels report it in
 * `user_info`, read fresh on every call because other devices of the same
 * account take connections too. M3U and Stalker report nothing: null,
 * shown as "limit ?". Never throws; an unreachable panel is also null.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionBudgetService implements MultiviewConnectionBudgetSource {
    private readonly playlists = inject(PlaylistsService);
    private readonly xtream = inject(XtreamApiService);

    async budgetFor(
        playlistId: string
    ): Promise<MultiviewConnectionBudget | null> {
        try {
            const playlist = await firstValueFrom(
                this.playlists.getPlaylistById(playlistId)
            );
            if (
                !playlist?.serverUrl ||
                !playlist.username ||
                !playlist.password ||
                playlist.macAddress
            ) {
                return null;
            }
            const info = await this.xtream.getAccountInfo(
                {
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                    userAgent: playlist.userAgent?.trim() || undefined,
                },
                { suppressErrorLog: true }
            );
            return connectionBudgetFromUserInfo(
                info?.user_info,
                sourceSortName(playlist)
            );
        } catch {
            return null;
        }
    }
}

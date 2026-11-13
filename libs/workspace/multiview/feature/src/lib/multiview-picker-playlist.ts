import type { MultiviewConnectionBudget } from '@iptvnator/playback/multiview/data-access';
import { sourceSortName } from '@iptvnator/playlist/shared/util';
import type { PlaylistsService } from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import type { ConnectionBudgetService } from './connection-budget.service';

/** The current playlist as the picker's navigation lists it (Q2). */
export interface MultiviewPickerPlaylist {
    readonly name: string;
    readonly type: 'xtream' | 'm3u' | 'stalker';
}

/** The current playlist's name, type and connection budget. */
export async function loadPickerPlaylist(
    playlistId: string,
    playlists: Pick<PlaylistsService, 'getPlaylistById'>,
    budgets: Pick<ConnectionBudgetService, 'budgetFor'>
): Promise<{
    readonly playlist: MultiviewPickerPlaylist | null;
    readonly budget: MultiviewConnectionBudget | null;
}> {
    const [meta, budget] = await Promise.all([
        firstValueFrom(playlists.getPlaylistById(playlistId)).catch(() => null),
        budgets.budgetFor(playlistId),
    ]);
    return {
        playlist: meta
            ? {
                  name: sourceSortName(meta),
                  type: meta.macAddress
                      ? 'stalker'
                      : meta.serverUrl
                        ? 'xtream'
                        : 'm3u',
              }
            : null,
        budget,
    };
}

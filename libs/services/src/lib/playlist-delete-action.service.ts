import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    DatabaseService,
    type DbOperationEvent,
} from './database-electron.service';
import { PlaylistsService } from './playlists.service';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

export interface PlaylistDeleteActionOptions {
    /**
     * Receives Electron DB progress events only for Xtream-style playlists that
     * have a server URL. PWA deletes and non-Xtream Electron deletes do not emit
     * playlist delete progress events.
     */
    readonly onEvent?: (event: DbOperationEvent) => void;
}

@Injectable({ providedIn: 'root' })
export class PlaylistDeleteActionService {
    private readonly databaseService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);

    async deletePlaylist(
        playlist: PlaylistMeta,
        options: PlaylistDeleteActionOptions = {}
    ): Promise<boolean> {
        try {
            const result = await this.deletePlaylistWithResult(
                playlist,
                options
            );
            return result.success;
        } catch {
            return false;
        }
    }

    async deletePlaylistWithResult(
        playlist: PlaylistMeta,
        options: PlaylistDeleteActionOptions = {}
    ): Promise<{ success: boolean; cleanupWarnings?: number }> {
        const workerOptions =
            playlist.serverUrl && this.runtime.supportsXtreamSqliteDataSource
                ? {
                      operationId:
                          this.databaseService.createOperationId(
                              'playlist-delete'
                          ),
                      onEvent: options.onEvent,
                  }
                : undefined;
        // Persistence owns serialization, the single worker invocation, and
        // post-delete cleanup. UI callers only commit the resulting state.
        return firstValueFrom(
            workerOptions
                ? this.playlistsService.deletePlaylist(
                      playlist._id,
                      workerOptions
                  )
                : this.playlistsService.deletePlaylist(playlist._id)
        );
    }
}

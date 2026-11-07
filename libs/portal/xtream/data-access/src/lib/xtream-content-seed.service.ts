import { inject, Injectable } from '@angular/core';
import { DatabaseService, SettingsStore } from '@iptvnator/services';
import {
    shouldImportLive,
    shouldImportVod,
} from '@iptvnator/shared/interfaces';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import type {
    CategoryType,
    StreamType,
    XtreamCredentials,
} from './services/xtream-api.service';
import type { PortalContentSeeder } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';

/**
 * Fills the stored catalogs of a freshly imported Xtream source: categories
 * plus live channels, and — only when the row's import scope wants them —
 * movies and series. The workspace hydrates from those stores on first
 * open, so a bulk-imported source is usable without waiting for a live
 * portal download there. Rejects when the portal cannot be read or has no
 * live channels, so the bulk import can skip the source.
 */
@Injectable({ providedIn: 'root' })
export class XtreamContentSeedService implements PortalContentSeeder {
    private readonly dataSource = inject(XTREAM_DATA_SOURCE);
    private readonly databaseService = inject(DatabaseService);
    private readonly settingsStore = inject(SettingsStore);

    async seed(playlist: Playlist, signal?: AbortSignal): Promise<void> {
        const playlistId = playlist._id;
        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl ?? '',
            username: playlist.username ?? '',
            password: playlist.password ?? '',
        };
        if (
            !playlistId ||
            !credentials.serverUrl ||
            !credentials.username ||
            !credentials.password
        ) {
            return;
        }
        throwIfAborted(signal);

        // The global Disable VOD setting wins over the row's scope, exactly
        // like the workspace catalogs: even a VOD-only row seeds live only.
        const importVod =
            shouldImportVod(playlist) &&
            this.settingsStore.disableVod?.() !== true;
        const importLive = shouldImportLive(playlist) || !importVod;

        const categoryTypes: CategoryType[] = importLive
            ? importVod
                ? ['live', 'vod', 'series']
                : ['live']
            : ['vod', 'series'];
        for (const type of categoryTypes) {
            throwIfAborted(signal);
            await this.dataSource.getCategories(playlistId, credentials, type, {
                signal,
            });
        }

        const streamTypes: StreamType[] = importLive
            ? importVod
                ? ['live', 'movie', 'series']
                : ['live']
            : ['movie', 'series'];
        for (const type of streamTypes) {
            throwIfAborted(signal);
            const content = await this.dataSource.getContent(
                playlistId,
                credentials,
                type,
                undefined,
                undefined,
                { signal }
            );
            throwIfAborted(signal);
            // A portal that answers with no channels is not a usable live
            // source; the bulk import skips it like a failed one.
            if (type === 'live' && content.length === 0) {
                throw new Error('The source returned no live channels');
            }
            // Mark the section done so the workspace's first open reads
            // the cache instead of re-fetching it from the portal.
            await this.databaseService.setXtreamImportStatus(
                playlistId,
                type,
                'completed'
            );
        }
    }
}

/** An abandoned row must not keep fetching beside the next import. */
function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        const error = new Error('The import moved on');
        error.name = 'AbortError';
        throw error;
    }
}

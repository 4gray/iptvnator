import { inject, Provider } from '@angular/core';
import {
    PLAYLIST_DELETE_CLEANUP,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { ElectronXtreamDataSource } from './electron-xtream-data-source';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import {
    IXtreamDataSource,
    XTREAM_DATA_SOURCE,
} from './xtream-data-source.interface';

// Re-export all types and interfaces
export * from './xtream-data-source.interface';
export { ElectronXtreamDataSource } from './electron-xtream-data-source';
export { PwaXtreamDataSource } from './pwa-xtream-data-source';

/**
 * Factory function that returns the appropriate data source based on environment.
 * - Electron: Uses DatabaseService for DB-first caching
 * - PWA: Uses API-only with in-memory caching and localStorage for user data
 */
export function xtreamDataSourceFactory(): IXtreamDataSource {
    const runtime = inject(RuntimeCapabilitiesService);

    if (runtime.supportsXtreamSqliteDataSource) {
        return inject(ElectronXtreamDataSource);
    }

    return inject(PwaXtreamDataSource);
}

/**
 * Provider for the Xtream data source.
 * Add this to your app providers to enable the data source abstraction.
 */
export function provideXtreamDataSource(): Provider[] {
    return [
        ElectronXtreamDataSource,
        PwaXtreamDataSource,
        {
            provide: XTREAM_DATA_SOURCE,
            useFactory: xtreamDataSourceFactory,
        },
        {
            provide: PLAYLIST_DELETE_CLEANUP,
            multi: true,
            useFactory: () => {
                const dataSource = inject(XTREAM_DATA_SOURCE);
                const runtime = inject(RuntimeCapabilitiesService);

                return (playlistId: string) => {
                    if (runtime.supportsXtreamSqliteDataSource) {
                        // Electron playlist deletion must use DatabaseService so
                        // SQLite content and sidecars are cleaned together; do
                        // not invoke this cleanup path through PlaylistsService.
                        return Promise.resolve();
                    }

                    return dataSource.deletePlaylist(playlistId);
                };
            },
        },
    ];
}

import { EnvironmentProviders, inject, Provider } from '@angular/core';
import { ElectronXtreamDataSource } from './electron-xtream-data-source';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import { IXtreamDataSource, XTREAM_DATA_SOURCE } from './xtream-data-source.interface';

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
    // Check if we're in Electron environment
    if (typeof window !== 'undefined' && (window as any).electron) {
        return inject(ElectronXtreamDataSource);
    }

    // Default to PWA implementation
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
    ];
}

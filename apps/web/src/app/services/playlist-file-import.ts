import type { EnvironmentInjector } from '@angular/core';
import { PlaylistFileImportService } from '@iptvnator/playlist/shared/util/playlist-file-import';

/** Resolve the shared root service only after the OS delivers a file. */
export function resolvePlaylistFileImportService(
    injector: EnvironmentInjector
) {
    return injector.get(PlaylistFileImportService);
}

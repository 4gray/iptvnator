import { DestroyRef, effect, inject, untracked } from '@angular/core';
import { PlaylistMeta, sourceHealthKey } from '@iptvnator/shared/interfaces';
import { SourceStatusService } from './source-status.service';

/**
 * Keeps every listed source checked for as long as the caller lives,
 * whatever rows it shows. A status filter hides the sources that have no
 * result yet, and their rows were what started the checks, so a saved
 * "Responding" filter stayed empty after a restart.
 *
 * Desktop only: there the status filter exists and a check is one shared
 * job per source, which a row's own check joins rather than repeats. A
 * source whose address changes is checked again. Call it in an injection
 * context.
 */
export function keepSourcesChecked(
    playlists: () => readonly PlaylistMeta[]
): void {
    const status = inject(SourceStatusService);
    if (!status.supportsStatusFilter) {
        return;
    }
    const running = new Map<string, AbortController>();

    effect(() => {
        const wanted = new Map<string, PlaylistMeta>();
        for (const playlist of playlists()) {
            if (status.tracks(playlist)) {
                wanted.set(
                    `${playlist._id}\u0000${sourceHealthKey(playlist)}`,
                    playlist
                );
            }
        }
        // The checks publish their results through signals; reading them
        // here would restart every check on every result.
        untracked(() => {
            for (const [key, controller] of running) {
                if (!wanted.has(key)) {
                    controller.abort();
                    running.delete(key);
                }
            }
            for (const [key, playlist] of wanted) {
                if (!running.has(key)) {
                    const controller = new AbortController();
                    running.set(key, controller);
                    status.ensureChecked(playlist, controller.signal);
                }
            }
        });
    });

    inject(DestroyRef).onDestroy(() => {
        running.forEach((controller) => controller.abort());
        running.clear();
    });
}

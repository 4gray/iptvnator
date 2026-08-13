import { Signal, effect, signal } from '@angular/core';
import { ContentMetadataPatch } from '@iptvnator/shared/interfaces';
import {
    XtreamDetailMetadataSource,
    xtreamContentMetadataKey,
    xtreamDetailContentMetadata,
} from './xtream-content-metadata.util';

/** What the backfill needs off the store, kept structural to avoid a cycle */
interface ContentMetadataBackfillStore {
    currentPlaylist: Signal<{ id: string } | null | undefined>;
    backfillContentMetadata(input: {
        xtreamId: number | string;
        contentType: 'live' | 'movie' | 'series';
        playlist: Signal<{ id: string } | null | undefined>;
        patch: ContentMetadataPatch;
    }): Promise<void>;
}

/**
 * Hand back to the `content` row what this detail view learned about the
 * item — its backdrop, and the identity a dashboard lookup needs to repeat
 * this view's TMDB query instead of rebuilding a weaker one from the title.
 *
 * Registers an effect, so it must be called from an injection context.
 *
 * The VOD and series detail views differ only in where they read the id and
 * the detail payload from, so they share this rather than each keeping a
 * copy: both are near the file-size limit, and a duplicated effect is how the
 * guard below drifts apart between them.
 */
export function registerContentMetadataBackfill(options: {
    store: ContentMetadataBackfillStore;
    contentType: 'movie' | 'series';
    playlistId: () => string | null | undefined;
    xtreamId: () => number;
    info: () => XtreamDetailMetadataSource | null | undefined;
}): void {
    const lastKey = signal<string | null>(null);

    effect(() => {
        const playlistId = options.playlistId();
        const xtreamId = options.xtreamId();
        const patch = xtreamDetailContentMetadata(options.info());

        if (
            !playlistId ||
            !Number.isFinite(xtreamId) ||
            xtreamId <= 0 ||
            !patch
        ) {
            return;
        }

        // Keyed on the WHOLE patch: this re-runs as enrichment fills the TMDB
        // id in, and a key built from the backdrop alone would suppress the
        // write carrying the id that arrives moments later.
        const key = `${playlistId}:${xtreamId}:${xtreamContentMetadataKey(patch)}`;
        if (lastKey() === key) {
            return;
        }

        lastKey.set(key);
        void options.store.backfillContentMetadata({
            xtreamId,
            contentType: options.contentType,
            playlist: options.store.currentPlaylist,
            patch,
        });
    });
}

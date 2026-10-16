import { Injectable, Signal, signal } from '@angular/core';
import { Channel } from '@iptvnator/shared/interfaces';

export interface M3uCatalogSectionFlags {
    readonly movies: boolean;
    readonly series: boolean;
}

/** The part of the catalog index the startup path reads. */
export interface M3uCatalogSectionsSource {
    sectionsOf(playlistId: string): M3uCatalogSectionFlags | null;
    readonly liveChannels: Signal<readonly Channel[]>;
}

/**
 * The catalog index as the startup path sees it.
 *
 * The shell rail, section memory and channel zapping are created with the
 * app. Injecting `M3uCatalogIndexService` there put the content classifier
 * and the index builder in the initial bundle, although nothing has rows to
 * classify until an M3U route loads them. They read through this instead:
 * the index attaches itself when an M3U route first creates it, and the
 * answers are its own, read synchronously as before.
 *
 * Before that, every answer is "not known": no playlist has been opened
 * this session, which is what the index would have answered too.
 */
@Injectable({ providedIn: 'root' })
export class M3uCatalogSectionsRegistry {
    private readonly source = signal<M3uCatalogSectionsSource | null>(null);

    attach(source: M3uCatalogSectionsSource): void {
        this.source.set(source);
    }

    /** See `M3uCatalogIndexService.sectionsOf`. */
    sectionsOf(playlistId: string): M3uCatalogSectionFlags | null {
        return this.source()?.sectionsOf(playlistId) ?? null;
    }

    /** The live list, or null until the index exists. */
    liveChannels(): readonly Channel[] | null {
        return this.source()?.liveChannels() ?? null;
    }
}

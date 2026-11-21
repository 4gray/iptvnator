import { signal } from '@angular/core';
import { Channel } from '@iptvnator/shared/interfaces';

export interface M3uCatalogSectionFlags {
    readonly movies: boolean;
    readonly series: boolean;
}

/** The part of the catalog index the startup path reads. */
export interface M3uCatalogSectionsSource {
    sectionsOf(playlistId: string): M3uCatalogSectionFlags | null;
    /**
     * The channel a next/previous step lands on, in the list the viewer
     * sees; undefined past either end. See `resolveAdjacentChannel`.
     */
    adjacentChannel(
        direction: 'next' | 'previous',
        active: Channel | undefined,
        allChannels: readonly Channel[]
    ): Channel | undefined;
}

/**
 * The catalog index as the startup path sees it.
 *
 * The shell rail, section memory and channel zapping are created with the
 * app. Injecting `M3uCatalogIndexService` there put the content classifier
 * and the index builder in the initial bundle, although nothing has rows to
 * classify until an M3U route loads them. They read through this instead:
 * the index sets itself here when an M3U route first creates it, and the
 * answers are its own, read synchronously as before.
 *
 * Until then it holds null — "not known": no playlist has been opened this
 * session, which is what the index would have answered too.
 *
 * A module-level signal rather than a provider on purpose. There is one
 * catalog index per app (`providedIn: 'root'`), every reader sits on the
 * startup path where each byte is ratcheted, and a signal costs a fraction
 * of an injection token plus its `inject()` calls there. Specs set it in
 * `beforeEach` and reset it to null afterwards.
 */
export const m3uCatalogSource = signal<M3uCatalogSectionsSource | null>(null);

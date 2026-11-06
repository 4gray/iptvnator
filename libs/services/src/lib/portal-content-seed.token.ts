import { InjectionToken } from '@angular/core';
import { Playlist } from '@iptvnator/shared/interfaces';

/**
 * Fills a portal source's stored catalogs (channels, movies, series) so a
 * source freshly added by a bulk import is ready before its workspace is
 * ever opened. The bulk import seeds sources one at a time under a
 * per-source timeout; implementations reject when the source cannot be
 * read, so the import skips that source and moves on to the next.
 *
 * A seeder may return the playlist it effectively used. Bulk rows are built
 * from a pasted file and carry the coordinates as written there — a Stalker
 * row, for example, holds the portal page a provider listed
 * (`http://panel/c`) plus an unobserved mode — so a seeder that has to
 * resolve the real endpoint returns the corrected row, and the bulk import
 * stores and shows THAT one instead of the guess. Returning nothing keeps
 * the playlist unchanged.
 */
export type PortalContentSeeder = {
    /**
     * `signal` aborts when the bulk import gives up on the row: an abandoned
     * source must stop fetching instead of downloading beside the next import.
     */
    seed(playlist: Playlist, signal?: AbortSignal): Promise<Playlist | void>;
};

export const PORTAL_CONTENT_SEEDERS = new InjectionToken<PortalContentSeeder[]>(
    'PORTAL_CONTENT_SEEDERS'
);

import { Injectable } from '@angular/core';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';

/**
 * External player sessions whose parental lock a feature enforces itself.
 *
 * The app-wide relock closes MPV/VLC sessions it cannot judge (their
 * category is not on the session). A feature that knows the category of the
 * sessions it launched — Xtream Live keeps the playing channel's category —
 * claims them here, so the generic closer leaves them to the owner, which
 * closes only those in a now-withheld category.
 */
@Injectable({ providedIn: 'root' })
export class ParentalLockSessionOwners {
    private readonly owners = new Set<
        (session: ExternalPlayerSession) => boolean
    >();

    /** Registers an ownership test. Returns the unregister function. */
    claim(owns: (session: ExternalPlayerSession) => boolean): () => void {
        this.owners.add(owns);
        return () => this.owners.delete(owns);
    }

    isOwned(session: ExternalPlayerSession): boolean {
        return [...this.owners].some((owns) => owns(session));
    }
}

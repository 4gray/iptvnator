import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** One row's favorite mark flipping, as seen by a channel list instance. */
export interface XtreamFavoriteMarkChange {
    readonly playlistId: string;
    /** `PortalChannelsListComponent.favoriteKeyFor` of the toggled row. */
    readonly key: string;
    readonly isFavorite: boolean;
}

/**
 * Relays favorite toggles between `PortalChannelsListComponent` instances.
 *
 * Each list instance owns the map behind its heart icons and loads it once
 * on init, and the store's `toggleFavorite` only reports the new state back
 * to the instance that asked. The fullscreen channel panel mounts a second
 * instance beside the sidebar, so without this relay a heart toggled in one
 * list stayed stale in the other until that list was recreated.
 */
@Injectable({ providedIn: 'root' })
export class XtreamFavoriteMarksService {
    private readonly changesSubject = new Subject<XtreamFavoriteMarkChange>();

    /** Every toggle reported by any list instance, own toggles included. */
    readonly changes$: Observable<XtreamFavoriteMarkChange> =
        this.changesSubject.asObservable();

    notify(change: XtreamFavoriteMarkChange): void {
        this.changesSubject.next(change);
    }
}

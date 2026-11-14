import { Injectable, inject } from '@angular/core';
import {
    MultiviewAnchorRegistry,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';

/**
 * What is on screen, in tile order, for "In tile N": the session's tiles,
 * or before a session the playback of the view it would start on, which
 * becomes tile 1.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewOnScreenSources {
    private readonly store = inject(MultiviewSessionStore);
    private readonly anchors = inject(MultiviewAnchorRegistry);

    current(): readonly MultiviewTileSource[] {
        if (this.store.exists()) return this.store.tiles();
        const source = this.anchors.current()?.host.source() ?? null;
        return source ? [source] : [];
    }
}

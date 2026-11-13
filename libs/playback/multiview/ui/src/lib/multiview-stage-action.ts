import { inject } from '@angular/core';
import { MultiviewEntryService } from '@iptvnator/playback/multiview/data-access';
import type { PlayerMultiviewAction } from '@iptvnator/ui/playback';

/**
 * The dock action of the main tile: adds a source to the running session.
 * Absent until a source picker exists, like the anchor's.
 */
export function stageMultiviewAction(): PlayerMultiviewAction | null {
    const entry = inject(MultiviewEntryService);
    return entry.hasPicker
        ? { enabled: entry.canAdd, run: () => void entry.pick() }
        : null;
}

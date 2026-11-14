import { DestroyRef, ElementRef, inject } from '@angular/core';
import {
    listenForChannelDrops,
    MultiviewChannelDrag,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

/**
 * Makes the calling component's host a drop target for channel rows
 * dragged from a list (R5). Must be called in an injection context.
 */
export function acceptChannelDrops(
    drop: (item: UnifiedCollectionItem) => void
): void {
    const remove = listenForChannelDrops(
        inject(ElementRef).nativeElement,
        inject(MultiviewChannelDrag),
        { enabled: () => true, drop }
    );
    inject(DestroyRef).onDestroy(remove);
}

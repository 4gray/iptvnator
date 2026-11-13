import { Injectable } from '@angular/core';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

/** The drag data type of a channel row dragged towards the player (R5). */
export const MULTIVIEW_CHANNEL_DRAG_TYPE = 'application/x-iptvnator-channel';

/**
 * Carries a dragged channel row from a list to the multiview drop targets.
 * The data transfer holds only a token: the row itself stays in the app.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewChannelDrag {
    private current: { token: string; item: UnifiedCollectionItem } | null =
        null;
    private sequence = 0;

    start(item: UnifiedCollectionItem, transfer: DataTransfer | null): void {
        const token = `channel-${++this.sequence}`;
        this.current = { token, item };
        transfer?.setData(MULTIVIEW_CHANNEL_DRAG_TYPE, token);
        if (transfer) transfer.effectAllowed = 'copy';
    }

    /** Whether a drag over a target carries a channel (for `dragover`). */
    carries(transfer: DataTransfer | null): boolean {
        return !!transfer?.types.includes(MULTIVIEW_CHANNEL_DRAG_TYPE);
    }

    /** The dropped channel, once; null for any other drop. */
    take(transfer: DataTransfer | null): UnifiedCollectionItem | null {
        const token = transfer?.getData(MULTIVIEW_CHANNEL_DRAG_TYPE);
        const current = this.current;
        this.current = null;
        return current && token === current.token ? current.item : null;
    }

    end(): void {
        this.current = null;
    }
}

/** Class a drop target carries while a channel is dragged over it. */
export const MULTIVIEW_DROP_TARGET_CLASS = 'multiview-drop-target';

/**
 * Makes an element a drop target for dragged channel rows. `enabled` is
 * read on every drag, so a target can switch on and off with the session.
 * Returns the function that removes the listeners.
 */
export function listenForChannelDrops(
    element: HTMLElement,
    drag: MultiviewChannelDrag,
    options: {
        readonly enabled: () => boolean;
        readonly drop: (item: UnifiedCollectionItem) => void;
    }
): () => void {
    const accepts = (event: DragEvent): boolean =>
        options.enabled() && drag.carries(event.dataTransfer);
    const over = (event: DragEvent): void => {
        if (!accepts(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        element.classList.add(MULTIVIEW_DROP_TARGET_CLASS);
    };
    const leave = (event: DragEvent): void => {
        if (!element.contains(event.relatedTarget as Node | null)) {
            element.classList.remove(MULTIVIEW_DROP_TARGET_CLASS);
        }
    };
    const dropped = (event: DragEvent): void => {
        element.classList.remove(MULTIVIEW_DROP_TARGET_CLASS);
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const item = drag.take(event.dataTransfer);
        if (item) options.drop(item);
    };
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', dropped);
    return () => {
        element.removeEventListener('dragover', over);
        element.removeEventListener('dragleave', leave);
        element.removeEventListener('drop', dropped);
    };
}

import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import {
    listenForChannelDrops,
    MultiviewChannelDrag,
    MultiviewEntryService,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { PLAYER_MULTIVIEW_ACTION } from '../player-controls/player-multiview-action';
import { MULTIVIEW_ANCHOR } from './multiview-anchor';

/**
 * Marks the player a view wraps as its multiview anchor. It gives that
 * player's dock the anchor's multiview action (spec 9.1) — other players in
 * the view, such as a movie detail's, get none — and tells the anchor where
 * the player is, so tile 1 continues a VOD from there (R1). Media events do
 * not bubble, so the position is read in the capture phase.
 */
@Directive({
    selector: '[appMultiviewPlayer]',
    providers: [
        {
            provide: PLAYER_MULTIVIEW_ACTION,
            useFactory: () =>
                inject(MULTIVIEW_ANCHOR, { optional: true })?.action ?? null,
        },
    ],
})
export class MultiviewPlayerDirective {
    constructor() {
        const anchor = inject(MULTIVIEW_ANCHOR, { optional: true });
        if (!anchor) return;
        const element: HTMLElement = inject(ElementRef).nativeElement;
        const onTimeUpdate = (event: Event): void => {
            if (event.target instanceof HTMLMediaElement) {
                anchor.notePosition(event.target.currentTime);
            }
        };
        element.addEventListener('timeupdate', onTimeUpdate, true);
        anchor.attachPlayer(element);
        // R1/R5: a channel dragged onto the view's player starts multiview.
        const entry = inject(MultiviewEntryService);
        const store = inject(MultiviewSessionStore);
        const removeDrops = listenForChannelDrops(
            element,
            inject(MultiviewChannelDrag),
            {
                enabled: () => !store.exists() && entry.canAddChannel(),
                drop: (item) => void entry.addChannel(item),
            }
        );
        inject(DestroyRef).onDestroy(() => {
            removeDrops();
            element.removeEventListener('timeupdate', onTimeUpdate, true);
            anchor.attachPlayer(null);
        });
    }
}

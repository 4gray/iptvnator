import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
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
        inject(DestroyRef).onDestroy(() => {
            element.removeEventListener('timeupdate', onTimeUpdate, true);
            anchor.attachPlayer(null);
        });
    }
}

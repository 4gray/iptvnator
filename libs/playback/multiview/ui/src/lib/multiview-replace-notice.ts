import { effect, inject, untracked } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MultiviewSessionStore } from '@iptvnator/playback/multiview/data-access';
import { TranslateService } from '@ngx-translate/core';

/** How long the replacement toast offers Undo. */
export const MULTIVIEW_REPLACE_UNDO_MS = 6000;

/**
 * R6, D1: when a source replaces a tile — an add while the layout is full,
 * a replace from the picker, a channel dropped on a tile — a toast names the
 * tile and offers Undo, which restores the previous source where it was.
 * Must be called in an injection context.
 */
export function announceReplacements(): void {
    const store = inject(MultiviewSessionStore);
    const snackBar = inject(MatSnackBar);
    const translate = inject(TranslateService);
    let seen = store.notice()?.sequence ?? 0;
    effect(() => {
        const notice = store.notice();
        untracked(() => {
            if (!notice || notice.sequence <= seen) return;
            seen = notice.sequence;
            const effect = notice.effect;
            if (effect.type !== 'replaced') return;
            snackBar
                .open(
                    translate.instant('PLAYER.MULTIVIEW.REPLACED', {
                        number: effect.tileNumber,
                    }),
                    translate.instant('PORTALS.MULTI_SOURCE.UNDO'),
                    { duration: MULTIVIEW_REPLACE_UNDO_MS }
                )
                .onAction()
                .subscribe(() => store.undoReplace(effect.previous));
        });
    });
}

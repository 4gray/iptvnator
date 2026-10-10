import { inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';

/**
 * A signal that changes whenever `TranslateService.instant` may answer
 * differently — on the same three events the translate pipe re-renders on:
 *
 * - `onLangChange`: a runtime language switch, or the first `use()` once its
 *   dictionary has loaded;
 * - `onDefaultLangChange`: the default language's dictionary landing. A
 *   start-up that never calls `use()` (no saved language) fires only this;
 * - `onTranslationChange`: a dictionary of the current language updated.
 *
 * Read it inside every `computed` that calls `instant` (or keep keys in state
 * and translate in the template). Without it the computed keeps the text of
 * the moment it first ran: the previous language, or raw keys when it ran
 * before the dictionary arrived. Call it in an injection context.
 */
export function injectTranslationTick(): Signal<unknown> {
    const translate = inject(TranslateService);
    return toSignal(
        merge(
            translate.onLangChange,
            translate.onDefaultLangChange,
            translate.onTranslationChange
        ),
        { initialValue: null }
    );
}

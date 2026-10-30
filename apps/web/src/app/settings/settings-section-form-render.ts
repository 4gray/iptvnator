import { ChangeDetectorRef, inject, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { EMPTY, switchMap } from 'rxjs';

/**
 * Marks an OnPush settings section for check on every event of its form.
 *
 * The sections read form values and states in their templates (selected
 * theme, `epgField.value`, `form().value.player`), which are not signals.
 * The parent changes the form outside the section's template events: Discard
 * and backup import patch it, the store hydrates it, and the EPG file picker
 * sets a control after an `await`. Without this the section keeps showing
 * the previous value until some unrelated event marks it. `events` covers
 * value, status, touched and pristine changes, including those of child
 * controls, which bubble up to the group.
 *
 * Call it from a field initializer or the constructor.
 */
export function markSectionForCheckOnFormEvents(
    form: Signal<AbstractControl | null>
): void {
    const changeDetector = inject(ChangeDetectorRef);
    toObservable(form)
        .pipe(
            switchMap((control) => control?.events ?? EMPTY),
            takeUntilDestroyed()
        )
        .subscribe(() => changeDetector.markForCheck());
}

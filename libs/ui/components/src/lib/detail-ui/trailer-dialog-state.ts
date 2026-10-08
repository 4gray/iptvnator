import { computed, Injectable, signal } from '@angular/core';

/**
 * Whether a trailer modal is open. The hero's trailer backdrop reads it and
 * unmounts meanwhile: the modal plays its own copy, and opening it neither
 * blurs the window nor hides the document, so nothing else would stop the
 * backdrop's sound.
 */
@Injectable({ providedIn: 'root' })
export class TrailerDialogState {
    private readonly openDialogs = signal(0);
    readonly dialogOpen = computed(() => this.openDialogs() > 0);

    opened(): void {
        this.openDialogs.update((count) => count + 1);
    }

    closed(): void {
        this.openDialogs.update((count) => Math.max(0, count - 1));
    }
}

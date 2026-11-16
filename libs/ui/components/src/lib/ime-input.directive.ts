import { Directive, OnDestroy } from '@angular/core';

const IME_COMMIT_WINDOW_MS = 50;
const CANDIDATE_KEYS = new Set(['Enter', 'Escape', 'ArrowUp', 'ArrowDown']);

/** Tracks the candidate keys on a search input with a custom key handler. */
@Directive({
    selector: 'input[appImeInput]',
    host: {
        '(compositionend)': 'onCompositionEnd()',
        '(keyup)': 'reset()',
        '(blur)': 'reset()',
    },
})
export class ImeInputDirective implements OnDestroy {
    private commitTimer: ReturnType<typeof setTimeout> | undefined;

    onCompositionEnd(): void {
        this.reset();
        // Let the event loop expire the window so a slow compositionend
        // handler cannot turn Safari's paired keydown into a fresh Enter.
        this.commitTimer = setTimeout(() => {
            this.commitTimer = undefined;
        }, IME_COMMIT_WINDOW_MS);
    }

    reset(): void {
        clearTimeout(this.commitTimer);
        this.commitTimer = undefined;
    }

    ngOnDestroy(): void {
        this.reset();
    }

    isCompositionKey(event: Event): boolean {
        const { key, isComposing, keyCode } = event as KeyboardEvent;
        // Legacy Safari delivers the commit key after compositionend with 229.
        // Android also uses 229 for ordinary keys, so require a recent commit.
        return (
            CANDIDATE_KEYS.has(key) &&
            (isComposing || (keyCode === 229 && this.commitTimer !== undefined))
        );
    }
}

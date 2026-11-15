import { Directive } from '@angular/core';

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
export class ImeInputDirective {
    private commitUntil = -1;

    onCompositionEnd(): void {
        this.commitUntil = performance.now() + IME_COMMIT_WINDOW_MS;
    }

    reset(): void {
        this.commitUntil = -1;
    }

    isCompositionKey(event: Event): boolean {
        const { key, isComposing, keyCode } = event as KeyboardEvent;
        // Legacy Safari delivers the commit key after compositionend with 229.
        // Android also uses 229 for ordinary keys, so require a recent commit.
        return (
            CANDIDATE_KEYS.has(key) &&
            (isComposing ||
                (keyCode === 229 && performance.now() <= this.commitUntil))
        );
    }
}

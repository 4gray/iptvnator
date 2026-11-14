import { DestroyRef, effect, inject, untracked } from '@angular/core';
import type { MultiviewPickerSearchResults } from './multiview-picker-search';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Runs the picker search while the viewer types: debounced, and each run
 * supersedes the previous one, so a scope, data or EPG change (read by
 * `watch`) re-runs the same term and an older answer never wins. Must be
 * called in an injection context.
 */
export function searchAsTyped(options: {
    readonly term: () => string;
    /** Further inputs whose change re-runs the search. */
    readonly watch: () => void;
    readonly search: (term: string) => Promise<MultiviewPickerSearchResults>;
    readonly onStart: () => void;
    readonly onResults: (results: MultiviewPickerSearchResults | null) => void;
}): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let run = 0;
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    effect(() => {
        const term = options.term().trim();
        options.watch();
        untracked(() => {
            clearTimeout(timer);
            const current = ++run;
            if (!term) {
                options.onResults(null);
                return;
            }
            options.onStart();
            timer = setTimeout(async () => {
                const results = await options.search(term);
                if (current === run) options.onResults(results);
            }, SEARCH_DEBOUNCE_MS);
        });
    });
}

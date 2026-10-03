import { Signal } from '@angular/core';

/** A page's Back action, rendered in the workspace header's leading slot. */
export interface WorkspaceBackTarget {
    /** Accessible name and tooltip; null falls back to the generic "Back". */
    readonly label: Signal<string | null>;
    /** True while Escape on the page runs the same action. */
    readonly escapeShortcut: Signal<boolean>;
    run(): void;
}

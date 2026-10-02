import { computed, Injectable, Signal, signal } from '@angular/core';

/** A page's Back action, rendered in the workspace header's leading slot. */
export interface WorkspaceBackTarget {
    /** Accessible name and tooltip; null falls back to the generic "Back". */
    readonly label: Signal<string | null>;
    /** True while Escape on the page runs the same action. */
    readonly escapeShortcut: Signal<boolean>;
    run(): void;
}

/**
 * Owns the header's Back slot. Pages register while they offer Back; the most
 * recent registration wins, so a page opened above another one takes the slot
 * and hands it back when it goes away.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceBackNavigationService {
    private readonly targets = signal<readonly WorkspaceBackTarget[]>([]);

    readonly target = computed(() => {
        const targets = this.targets();
        return targets[targets.length - 1] ?? null;
    });

    /**
     * Returns the release function. It removes only this target: when one
     * page replaces another (a loading shell by the loaded one), creation and
     * destruction can interleave in either order.
     */
    register(target: WorkspaceBackTarget): () => void {
        this.targets.update((targets) => [
            ...targets.filter((entry) => entry !== target),
            target,
        ]);
        return () =>
            this.targets.update((targets) =>
                targets.filter((entry) => entry !== target)
            );
    }

    /** Runs the current target; false when no page offers Back. */
    goBack(): boolean {
        const target = this.target();
        if (!target) return false;
        target.run();
        return true;
    }
}

import { DOCUMENT, Location } from '@angular/common';
import {
    computed,
    DestroyRef,
    inject,
    Injectable,
    InjectionToken,
    signal,
} from '@angular/core';
import { WorkspaceBackTarget } from '@iptvnator/portal/shared/util';

/** The parts of the browser's Navigation API the history fallback reads. */
export type WorkspaceHistoryNavigation = Pick<
    Navigation,
    'currentEntry' | 'entries' | 'addEventListener' | 'removeEventListener'
>;

/**
 * The browser's Navigation API; null where it is missing (older Safari and
 * Firefox, jsdom), which leaves the header without the history fallback.
 */
export const WORKSPACE_HISTORY_NAVIGATION =
    new InjectionToken<WorkspaceHistoryNavigation | null>(
        'WORKSPACE_HISTORY_NAVIGATION',
        {
            providedIn: 'root',
            factory: () => inject(DOCUMENT).defaultView?.navigation ?? null,
        }
    );

/**
 * True when the previous history entry belongs to this document, i.e. the
 * router pushed it in this app session. Entries from before a reload or from
 * another page of the origin are excluded, so the fallback never leaves the
 * app or reloads it.
 */
function hasInAppPreviousEntry(history: WorkspaceHistoryNavigation): boolean {
    const index = history.currentEntry?.index ?? -1;
    return index > 0 && history.entries()[index - 1]?.sameDocument === true;
}

/**
 * Owns the header's Back slot. Pages register while they offer Back; the most
 * recent registration wins, so a page opened above another one takes the slot
 * and hands it back when it goes away. Without a registration the slot falls
 * back to browser history while an in-app previous entry exists, and is empty
 * otherwise (never a disabled arrow).
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceBackNavigationService {
    private readonly location = inject(Location);
    private readonly targets = signal<readonly WorkspaceBackTarget[]>([]);
    private readonly canGoBackInApp = signal(false);

    /**
     * Generic Back to the previous page. It advertises no Escape (no page
     * handles one) and yields to the phone drawer toggle, so the categories
     * of a list reached by navigation stay reachable.
     */
    private readonly historyTarget: WorkspaceBackTarget = {
        label: signal(null),
        escapeShortcut: signal(false),
        phoneDrawerToggle: 'yield',
        run: () => this.location.back(),
    };

    readonly target = computed(() => {
        const targets = this.targets();
        return (
            targets[targets.length - 1] ??
            (this.canGoBackInApp() ? this.historyTarget : null)
        );
    });

    constructor() {
        const history = inject(WORKSPACE_HISTORY_NAVIGATION);
        if (!history) return;
        // Fires for router pushes and replacements and for traversals,
        // including a guard-cancelled Back that the router rewrites.
        const sync = () =>
            this.canGoBackInApp.set(hasInAppPreviousEntry(history));
        sync();
        history.addEventListener('currententrychange', sync);
        inject(DestroyRef).onDestroy(() =>
            history.removeEventListener('currententrychange', sync)
        );
    }

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

    /** Runs the current target; false when the header shows no Back. */
    goBack(): boolean {
        const target = this.target();
        if (!target) return false;
        target.run();
        return true;
    }
}

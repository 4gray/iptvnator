import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Open/closed state of the workspace context panel when it renders as an
 * off-canvas drawer (phone widths, ≤640px). On wider viewports the panel is
 * always visible beside the content and this state has no visual effect —
 * the drawer styles only apply inside the phone media query, so the service
 * can stay viewport-agnostic.
 *
 * Provided by WorkspaceShellComponent so the state dies with the shell. The
 * context panels inject it optionally: closing after a selection is a
 * drawer-only concern, and several selections (Stalker ITV/radio categories,
 * settings sections, sources filters, collection filters) update stores
 * without navigating, so a NavigationEnd listener alone cannot cover them.
 */
@Injectable()
export class WorkspaceShellContextDrawerService {
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    private readonly openState = signal(false);
    readonly isOpen = this.openState.asReadonly();

    constructor() {
        // Selections that navigate (Xtream VOD/series/live categories,
        // Stalker VOD/series, the settings back button) close the drawer
        // here rather than through per-call-site hooks.
        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => this.openState.set(false));
    }

    toggle(): void {
        this.openState.update((open) => !open);
    }

    close(): void {
        this.openState.set(false);
    }
}

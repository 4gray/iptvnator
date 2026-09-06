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
 * Root-provided from the shell's util lib so consumers outside the shell's
 * element injector — AppComponent's global Ctrl/Cmd+R shortcut, the Embedded
 * MPV overlay-visibility gate — can also observe the modal state without
 * pulling the lazy shell feature chunk into the eager bundle. The context
 * panels inject it optionally: closing after a selection is a drawer-only
 * concern, and several selections (Stalker ITV/radio categories, settings
 * sections, sources filters, collection filters) update stores without
 * navigating, so a NavigationEnd listener alone cannot cover them.
 */
@Injectable({ providedIn: 'root' })
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

        // A drawer left open while the viewport grows past the phone
        // breakpoint would keep its focus trap active on the now in-flow
        // desktop sidebar, holding keyboard focus hostage. Guarded because
        // JSDOM has no matchMedia.
        const media =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function'
                ? window.matchMedia('(max-width: 640px)')
                : null;
        if (media) {
            const onChange = (event: MediaQueryListEvent) => {
                if (!event.matches) {
                    this.openState.set(false);
                }
            };
            media.addEventListener('change', onChange);
            this.destroyRef.onDestroy(() =>
                media.removeEventListener('change', onChange)
            );
        }
    }

    toggle(): void {
        this.openState.update((open) => !open);
    }

    /**
     * Opens the drawer. Only meaningful at phone widths; on wider viewports
     * the panel is in flow and the styles ignore this state.
     */
    open(): void {
        this.openState.set(true);
    }

    close(): void {
        this.openState.set(false);
    }
}

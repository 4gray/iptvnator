import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    DestroyRef,
    effect,
    inject,
    Injectable,
    Injector,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
    LiveCategoriesPopover,
    LiveLayoutSidebarStateService,
} from '@iptvnator/portal/shared/util';
import { WorkspaceLiveCategoriesPopoverComponent } from './workspace-live-categories-popover.component';

/**
 * Shell-side implementation of `LIVE_CATEGORIES_POPOVER`. Provided on the
 * workspace shell so the live layouts rendered in its router outlet can open
 * the folded categories rail as a popover under their category dropdown.
 *
 * One popover at a time: opening from the origin that already owns it closes
 * it (toggle), opening from another origin moves it. The transparent backdrop
 * and Escape close it, and so does any category selection or the footer's
 * "show categories panel" action, which the component reports through
 * `closed`. Any router navigation closes it too: the shell (and so this
 * service) outlives the child route that owns the trigger, and browser
 * Back/Forward or a global shortcut route would otherwise leave the panel
 * floating over the destination page, re-rendered for the new route's
 * context. So does any live-panel level change: `Cmd/Ctrl+B` reaches the
 * layout's document-level handler through the dialog, and the trigger that
 * owns this popover is then inside a folded, `inert` rail.
 */
@Injectable()
export class WorkspaceLiveCategoriesPopoverService
    implements LiveCategoriesPopover
{
    private readonly overlay = inject(Overlay);
    private readonly injector = inject(Injector);
    private overlayRef: OverlayRef | null = null;
    private origin: HTMLElement | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => this.close());
        inject(Router)
            .events.pipe(
                filter((event) => event instanceof NavigationStart),
                takeUntilDestroyed()
            )
            .subscribe(() => this.close());
        // Seeded by the effect's first run, not at construction: the state
        // may move between the two before anything is open.
        const sidebarState = inject(LiveLayoutSidebarStateService).state;
        let previous: string | null = null;
        effect(() => {
            const next = sidebarState();
            const changed = previous !== null && next !== previous;
            previous = next;
            if (changed) {
                untracked(() => this.close());
            }
        });
    }

    open(origin: HTMLElement): void {
        if (this.overlayRef && this.origin === origin) {
            this.close();
            return;
        }
        this.close();

        const overlayRef = this.overlay.create({
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-transparent-backdrop',
            panelClass: 'workspace-live-categories-popover-pane',
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
            positionStrategy: this.overlay
                .position()
                .flexibleConnectedTo(origin)
                .withPositions([
                    {
                        originX: 'start',
                        originY: 'bottom',
                        overlayX: 'start',
                        overlayY: 'top',
                        offsetY: 6,
                    },
                    {
                        originX: 'start',
                        originY: 'top',
                        overlayX: 'start',
                        overlayY: 'bottom',
                        offsetY: -6,
                    },
                ])
                .withFlexibleDimensions(true)
                .withGrowAfterOpen(true)
                .withPush(true)
                .withViewportMargin(8),
            maxHeight: 'min(480px, calc(100vh - 16px))',
        });
        this.overlayRef = overlayRef;
        this.origin = origin;

        const componentRef = overlayRef.attach(
            new ComponentPortal(
                WorkspaceLiveCategoriesPopoverComponent,
                null,
                this.injector
            )
        );
        componentRef.instance.closed.subscribe(() => this.close());
        overlayRef.backdropClick().subscribe(() => this.close());
        overlayRef.keydownEvents().subscribe((event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
                event.preventDefault();
                this.close();
            }
        });
        origin.setAttribute('aria-expanded', 'true');
    }

    close(): void {
        const overlayRef = this.overlayRef;
        const origin = this.origin;
        this.overlayRef = null;
        this.origin = null;
        origin?.setAttribute('aria-expanded', 'false');
        overlayRef?.dispose();
        // Focus returns to the trigger that opened the popover so keyboard
        // users continue where they acted instead of dropping to <body> —
        // unless that trigger sits in a rail that folded meanwhile; then the
        // layout's own handoff picks focus up.
        if (
            origin &&
            origin.isConnected &&
            overlayRef &&
            !origin.closest('[inert]')
        ) {
            origin.focus();
        }
    }
}

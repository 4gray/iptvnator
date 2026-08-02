import { Injectable, inject, signal } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';

@Injectable({ providedIn: 'root' })
export class EmbeddedMpvOverlayVisibilityService {
    readonly overlayActive = signal(false);

    private readonly overlayContainer = inject(OverlayContainer);
    private readonly dialog = inject(MatDialog);
    private observer: MutationObserver | null = null;
    private externalModalSurfaces = 0;

    constructor() {
        this.dialog.afterOpened.subscribe(() => this.recompute());
        this.dialog.afterAllClosed.subscribe(() => this.recompute());

        if (typeof MutationObserver !== 'undefined') {
            const container = this.overlayContainer.getContainerElement();
            this.observer = new MutationObserver(() => this.recompute());
            this.observer.observe(container, {
                childList: true,
                subtree: true,
            });
        }

        this.recompute();
    }

    /**
     * Registers a modal surface that does not live in the CDK overlay
     * container — e.g. the workspace's phone context drawer, a plain
     * translate-in DOM panel. The native-view video surface paints above
     * DOM stacking, so any such surface must hide it exactly like a
     * Material dialog does. Returns a release function; releasing twice is
     * a no-op so effect cleanups can call it defensively.
     */
    acquireExternalModalSurface(): () => void {
        this.externalModalSurfaces += 1;
        this.recompute();

        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.externalModalSurfaces -= 1;
            this.recompute();
        };
    }

    private recompute(): void {
        const dialogOpen = this.dialog.openDialogs.length > 0;
        const backdropPresent =
            this.overlayContainer
                .getContainerElement()
                .querySelector('.cdk-overlay-backdrop') !== null;
        const next =
            dialogOpen || backdropPresent || this.externalModalSurfaces > 0;
        // Plain set, no read-back guard: signals already skip notification
        // for equal values, and reading overlayActive here would silently
        // register it as a dependency of any reactive context that calls
        // into this service (acquireExternalModalSurface from an effect
        // looped forever on exactly that).
        this.overlayActive.set(next);
    }
}

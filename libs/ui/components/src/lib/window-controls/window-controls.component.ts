import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    inject,
    signal,
} from '@angular/core';
import { ElectronBridgeWindowState } from '@iptvnator/shared/interfaces';

/**
 * Renderer-drawn window-management buttons (minimize / maximize-restore /
 * close) for the frameless title bar on Windows and Linux. macOS keeps the
 * native traffic lights instead.
 *
 * Rendered once in the app root so the buttons stay reachable above
 * full-window content such as the multi-EPG overlay and dialog backdrops —
 * mirroring how the macOS traffic lights float above everything. CDK
 * overlays render as popovers in the browser top layer (above any
 * z-index), so the host is itself a manual popover and re-enters the top
 * layer whenever another popover opens, keeping the controls topmost.
 * Hidden while the window is in fullscreen, matching native title-bar
 * behavior.
 */
@Component({
    selector: 'app-window-controls',
    templateUrl: './window-controls.component.html',
    styleUrl: './window-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        popover: 'manual',
        '[class.is-hidden]': 'isFullScreen()',
    },
})
export class WindowControlsComponent implements AfterViewInit {
    readonly isMaximized = signal(false);
    readonly isFullScreen = signal(false);

    private readonly host =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

    constructor() {
        const bridge = window.electron;

        void bridge
            ?.getWindowState?.()
            .then((state) => this.applyState(state))
            .catch(() => undefined);

        const unsubscribe = bridge?.onWindowStateChange?.((state) =>
            this.applyState(state)
        );

        document.addEventListener('toggle', this.onDocumentToggle, true);

        inject(DestroyRef).onDestroy(() => {
            unsubscribe?.();
            document.removeEventListener('toggle', this.onDocumentToggle, true);
        });
    }

    ngAfterViewInit(): void {
        this.enterTopLayer();
    }

    onMinimize(): void {
        void window.electron?.minimizeWindow?.();
    }

    onToggleMaximize(): void {
        void window.electron
            ?.toggleMaximizeWindow?.()
            .then((state) => this.applyState(state))
            .catch(() => undefined);
    }

    onClose(): void {
        void window.electron?.closeWindow?.();
    }

    private applyState(state: ElectronBridgeWindowState | undefined): void {
        if (!state) {
            return;
        }

        this.isMaximized.set(state.isMaximized);
        this.isFullScreen.set(state.isFullScreen);
    }

    /**
     * Re-enter the top layer after any other popover opens: top-layer
     * elements paint in insertion order, so hiding and re-showing puts the
     * controls back above freshly opened CDK overlays (dialogs, multi-EPG).
     */
    private readonly onDocumentToggle = (event: Event): void => {
        const newState = (event as { newState?: string }).newState;
        if (event.target === this.host || newState !== 'open') {
            return;
        }

        requestAnimationFrame(() => this.enterTopLayer(true));
    };

    private enterTopLayer(reassert = false): void {
        if (
            typeof this.host.showPopover !== 'function' ||
            !this.host.isConnected
        ) {
            return;
        }

        try {
            if (this.host.matches(':popover-open')) {
                if (!reassert) {
                    return;
                }
                this.host.hidePopover();
            }
            this.host.showPopover();
        } catch {
            // Stays a regular fixed element when the popover API is
            // unavailable — still above non-top-layer content via z-index.
        }
    }
}

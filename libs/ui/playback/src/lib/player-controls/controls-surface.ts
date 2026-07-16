export interface ControlsSurfaceHandlers {
    /** Reveal the controls (pointer move / enter / click on the surface). */
    reveal: () => void;
    /** Toggle fullscreen on an unhandled double-click. */
    toggleFullscreen: () => void;
    /** Close popovers on an outside pointer-down. */
    closePopovers: () => void;
    /**
     * Toggle play/pause on a single click on the viewport (optional). When
     * provided, a single click on a non-interactive area of the surface toggles
     * playback after a short delay so a double-click (fullscreen) can cancel it.
     */
    togglePlay?: () => void;
    /** Whether a viewport click may currently queue a play/pause toggle. */
    canTogglePlay?: () => boolean;
    /** Whether a popover/menu is currently open (guards click-to-pause). */
    isMenuOpen?: () => boolean;
}

/**
 * The pause is deferred so a double-click (fullscreen) can cancel it before it
 * runs. Mirrors the embedded-MPV viewport click behavior.
 */
const VIEWPORT_CLICK_PAUSE_DELAY_MS = 250;

const INTERACTIVE_SELECTOR = 'button, input, [role="slider"]';

/**
 * Owns the surface + document interaction wiring for the controls: reveal on
 * pointer activity, click-to-pause on the viewport, fullscreen on double-click,
 * and popover dismissal on an outside pointer-down. The component binds
 * {@link attachSurface} from an effect and can provide a separate inside root
 * for controls rendered as a sibling of the playback surface.
 */
export class ControlsSurface {
    private surface: HTMLElement | null = null;
    private surfaceCleanup: (() => void) | null = null;
    private clickPauseTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly onDocumentPointerDown = (event: PointerEvent) => {
        const path = event.composedPath();
        if (
            !this.surface ||
            path.includes(this.surface) ||
            (this.insideRoot !== null && path.includes(this.insideRoot))
        ) {
            return;
        }
        this.handlers.closePopovers();
    };

    constructor(
        private readonly handlers: ControlsSurfaceHandlers,
        /** Additional root whose descendants count as inside for dismissal. */
        private readonly insideRoot: HTMLElement | null = null
    ) {
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'pointerdown',
                this.onDocumentPointerDown
            );
        }
    }

    /** Rebind the per-surface listeners; returns a cleanup for the effect. */
    attachSurface(surface: HTMLElement | null): () => void {
        this.clearClickPauseTimer();
        this.surfaceCleanup?.();
        this.surfaceCleanup = null;
        this.surface = surface;
        if (!surface) {
            return () => undefined;
        }
        const reveal = () => this.handlers.reveal();
        const click = (event: MouseEvent) => this.onClick(event);
        const dblclick = (event: MouseEvent) => this.onDblClick(event);
        surface.addEventListener('pointermove', reveal, { passive: true });
        surface.addEventListener('pointerenter', reveal);
        surface.addEventListener('click', click);
        surface.addEventListener('dblclick', dblclick);
        this.surfaceCleanup = () => {
            surface.removeEventListener('pointermove', reveal);
            surface.removeEventListener('pointerenter', reveal);
            surface.removeEventListener('click', click);
            surface.removeEventListener('dblclick', dblclick);
        };
        return () => this.surfaceCleanup?.();
    }

    dispose(): void {
        this.clearClickPauseTimer();
        this.surfaceCleanup?.();
        this.surfaceCleanup = null;
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'pointerdown',
                this.onDocumentPointerDown
            );
        }
    }

    private onClick(event: MouseEvent): void {
        // Always reveal the controls on a click on the surface.
        this.handlers.reveal();
        if (this.isInsideRoot(event)) {
            return;
        }
        if (!this.handlers.togglePlay) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) {
            return;
        }
        // A click while a menu is open dismisses it instead of toggling.
        if (this.handlers.isMenuOpen?.()) {
            this.handlers.closePopovers();
            return;
        }
        if (this.handlers.canTogglePlay?.() === false) {
            return;
        }
        this.clearClickPauseTimer();
        this.clickPauseTimer = setTimeout(() => {
            this.clickPauseTimer = null;
            this.handlers.togglePlay?.();
        }, VIEWPORT_CLICK_PAUSE_DELAY_MS);
    }

    private onDblClick(event: MouseEvent): void {
        // Cancel a pending single-click pause so a dblclick only fullscreens.
        this.clearClickPauseTimer();
        if (this.isInsideRoot(event)) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) {
            return;
        }
        this.handlers.toggleFullscreen();
    }

    private isInsideRoot(event: MouseEvent): boolean {
        if (!this.insideRoot) {
            return false;
        }
        const path = event.composedPath();
        const target = event.target as Node | null;
        return (
            path.includes(this.insideRoot) ||
            (target !== null && this.insideRoot.contains(target))
        );
    }

    private clearClickPauseTimer(): void {
        if (this.clickPauseTimer !== null) {
            clearTimeout(this.clickPauseTimer);
            this.clickPauseTimer = null;
        }
    }
}

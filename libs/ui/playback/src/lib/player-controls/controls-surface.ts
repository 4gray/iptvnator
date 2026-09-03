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
    /** Whether the controls overlay is currently visible (touch semantics). */
    controlsVisible?: () => boolean;
    /** Hide the controls if the owner's auto-hide policy permits it. */
    hideControls?: () => void;
}

/**
 * The pause is deferred so a double-click (fullscreen) can cancel it before it
 * runs. Mirrors the embedded-MPV viewport click behavior.
 */
const VIEWPORT_CLICK_PAUSE_DELAY_MS = 250;

/**
 * How long after a pointerdown a focus/click event is still attributed to
 * that press. Covers browsers whose click events are plain MouseEvents (no
 * pointerType) and focus handlers, which never carry a pointer type.
 */
const POINTER_ATTRIBUTION_WINDOW_MS = 1000;

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
    private lastTouchPointerDownAt: number | null = null;
    private lastPointerDown: { at: number; target: EventTarget | null } | null =
        null;

    private readonly onDocumentPointerDown = (event: PointerEvent) => {
        const now = Date.now();
        this.lastTouchPointerDownAt =
            event.pointerType === 'touch' ? now : null;
        this.lastPointerDown = { at: now, target: event.target };
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
        // Touch has no hover: the pointerenter/pointermove a tap synthesizes
        // must not reveal, or the tap's click could never see "controls were
        // hidden" and touch reveal/hide semantics would be unreachable.
        const reveal = (event: PointerEvent) => {
            if (event.pointerType === 'touch') {
                return;
            }
            this.handlers.reveal();
        };
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

    /**
     * Whether an event belongs to a touch interaction. Click events are
     * PointerEvents in current engines; the pointerdown timestamp covers
     * browsers still dispatching plain MouseEvent clicks and focus events.
     */
    wasTouchInteraction(event?: Event): boolean {
        const pointerType = (event as PointerEvent | undefined)?.pointerType;
        if (typeof pointerType === 'string' && pointerType !== '') {
            return pointerType === 'touch';
        }
        return (
            this.lastTouchPointerDownAt !== null &&
            Date.now() - this.lastTouchPointerDownAt <=
                POINTER_ATTRIBUTION_WINDOW_MS
        );
    }

    /**
     * Whether a focus event is the side effect of a pointer press on the
     * element that received focus. Chromium focuses a clicked `<button>`, so
     * `focusin` alone cannot tell a mouse click from Tab navigation; only the
     * latter should keep the controls pinned. The press must be recent and
     * must have landed inside the newly focused element — a Tab shortly after
     * a click on the video still counts as keyboard navigation.
     */
    wasPointerInteraction(event: FocusEvent): boolean {
        const press = this.lastPointerDown;
        if (
            press === null ||
            Date.now() - press.at > POINTER_ATTRIBUTION_WINDOW_MS
        ) {
            return false;
        }
        const focused = event.target;
        return (
            focused instanceof Node &&
            press.target instanceof Node &&
            focused.contains(press.target)
        );
    }

    private onClick(event: MouseEvent): void {
        const touch = this.wasTouchInteraction(event);
        // Capture before revealing: a touch tap's semantics depend on whether
        // the controls were visible when the tap landed.
        const controlsWereVisible = this.handlers.controlsVisible?.() ?? true;
        // A mouse click on the surface always reveals; a touch tap decides
        // between reveal and hide below.
        if (!touch) {
            this.handlers.reveal();
        }
        if (this.isInsideRoot(event) || !this.handlers.togglePlay) {
            if (touch) {
                this.handlers.reveal();
            }
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) {
            if (touch) {
                this.handlers.reveal();
            }
            return;
        }
        // A click while a menu is open dismisses it instead of toggling.
        if (this.handlers.isMenuOpen?.()) {
            this.handlers.closePopovers();
            return;
        }
        if (touch) {
            // Touch viewport taps toggle the overlay instead of playback:
            // the first tap on a hidden overlay must never pause the video.
            if (controlsWereVisible) {
                this.handlers.hideControls?.();
            } else {
                this.handlers.reveal();
            }
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

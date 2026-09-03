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
 * Controls whose pointer-originated focus is released once the click that
 * produced it completes. Text entry is deliberately absent: a click into a
 * field must not end typing. The bar holds none today.
 */
const POINTER_FOCUS_RELEASE_SELECTOR =
    'button, input[type="range"], [role="slider"]';

interface PointerPress {
    at: number;
    target: EventTarget | null;
}

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
    /** The most recent press, answered once by the focus event it moved. */
    private lastPointerDown: PointerPress | null = null;
    /** The same press, answered once by the click it completes into. */
    private lastPointerDownClick: PointerPress | null = null;
    /** Set while {@link releasePointerFocus} dispatches its `focusout`. */
    private pointerFocusRelease = false;

    private readonly onDocumentPointerDown = (event: PointerEvent) => {
        const now = Date.now();
        this.lastTouchPointerDownAt =
            event.pointerType === 'touch' ? now : null;
        const press: PointerPress = { at: now, target: event.target };
        this.lastPointerDown = press;
        this.lastPointerDownClick = press;
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

    /**
     * Keyboard input ends pointer attribution: focus that moves, or a click
     * that fires, after a key press was produced by the keyboard, whatever
     * the last press hit.
     */
    private readonly onDocumentKeyDown = () => {
        this.lastPointerDown = null;
        this.lastPointerDownClick = null;
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
            document.addEventListener('keydown', this.onDocumentKeyDown, {
                capture: true,
            });
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
            document.removeEventListener('keydown', this.onDocumentKeyDown, {
                capture: true,
            });
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
     *
     * A press moves focus at most once, and it does so synchronously, so the
     * focus change it caused is always the first focus event after it. The
     * record is therefore discarded on the first focus event it is asked
     * about, matching or not, and on any key press (`onDocumentKeyDown`).
     * Nothing a later Tab or Shift+Tab focuses can be attributed to a stale
     * press, including the control the press hit while it was already
     * focused and hence produced no focus event at all.
     */
    wasPointerInteraction(event: FocusEvent): boolean {
        const press = this.lastPointerDown;
        this.lastPointerDown = null;
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

    /**
     * Whether a click completes a pointer press rather than keyboard
     * activation or script. Click events are PointerEvents in current
     * engines and carry an empty `pointerType` when nothing pointed
     * (Enter/Space on a focused button, `element.click()`); a legacy
     * MouseEvent click is attributed to a recent press that landed inside
     * the clicked element. A press completes into at most one click, so the
     * record is discarded on the first click it is asked about and on any
     * key press (`onDocumentKeyDown`).
     */
    wasPointerClick(event: MouseEvent): boolean {
        const pointerType = (event as Partial<PointerEvent>).pointerType;
        if (typeof pointerType === 'string') {
            return pointerType !== '';
        }
        const press = this.lastPointerDownClick;
        this.lastPointerDownClick = null;
        if (
            press === null ||
            Date.now() - press.at > POINTER_ATTRIBUTION_WINDOW_MS
        ) {
            return false;
        }
        const clicked = event.target;
        return (
            clicked instanceof Node &&
            press.target instanceof Node &&
            clicked.contains(press.target)
        );
    }

    /**
     * Release the focus a pointer click left on a control inside `root`.
     * Chromium focuses a clicked `<button>`, and a focused control captures
     * the keyboard: Space and Enter activate it again and the playback
     * shortcuts yield to it (`ControlsShortcuts` ignores keys whose path
     * holds an interactive element). That focus was never the keyboard's,
     * so it is dropped once the click completes. Chromium keeps its
     * sequential focus navigation starting point at the blurred control, so
     * a later Tab continues from it exactly as if it were still focused.
     * Handlers of the resulting `focusout` can recognize the release through
     * {@link wasPointerFocusRelease}. Returns whether focus was released.
     */
    releasePointerFocus(root: HTMLElement): boolean {
        const active = root.ownerDocument.activeElement;
        if (
            !(active instanceof HTMLElement) ||
            !root.contains(active) ||
            !active.matches(POINTER_FOCUS_RELEASE_SELECTOR)
        ) {
            return false;
        }
        this.pointerFocusRelease = true;
        try {
            active.blur();
        } finally {
            this.pointerFocusRelease = false;
        }
        return true;
    }

    /**
     * Whether the `focusout` being dispatched right now comes from
     * {@link releasePointerFocus}: the pointer is still where it clicked, so
     * hover-scoped state (the volume popover) must not read it as focus
     * leaving by keyboard.
     */
    wasPointerFocusRelease(): boolean {
        return this.pointerFocusRelease;
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

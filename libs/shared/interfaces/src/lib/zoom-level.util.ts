/**
 * App zoom shortcut contract (Cmd/Ctrl and +/−/0), shared by the renderer
 * key binding (`WorkspaceKeyboardShortcutsService`) and the preload, which
 * applies the result through `webFrame.setZoomLevel` (issue #1109: the level
 * must stay a frame-bound temporary zoom; see
 * `docs/architecture/workspace-shell.md`, "Zoom level").
 *
 * A Chromium zoom level is the exponent of a 1.2 factor: level 1 renders at
 * 120 %, level −1 at ~83 %. The step matches Electron's `zoomIn`/`zoomOut`
 * menu roles (0.5, about 10 % per press), so the level the macOS menu used
 * to produce and the level the shortcuts produce are the same series.
 */

export type ZoomLevelAction = 'in' | 'out' | 'reset';

export const ZOOM_LEVEL_DEFAULT = 0;
/** Electron's `zoomIn`/`zoomOut` role step. */
export const ZOOM_LEVEL_STEP = 0.5;
/** ≈48 % — below this the workspace chrome is unreadable. */
export const ZOOM_LEVEL_MIN = -4;
/** ≈299 % — well inside Chromium's own 25–500 % limits. */
export const ZOOM_LEVEL_MAX = 6;

export function clampZoomLevel(level: number): number {
    if (!Number.isFinite(level)) {
        return ZOOM_LEVEL_DEFAULT;
    }

    return Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, level));
}

/**
 * The level `action` produces from `current`. Steps are snapped to the step
 * grid so a level restored from an older store (or set by the macOS menu
 * before the shortcuts existed) does not carry a fractional offset forever.
 * A level already outside the limits — the macOS menu roles never clamped,
 * and the store restores any finite level — is never moved AGAINST the
 * request: a press further out leaves it where it is, a press back in lands
 * on the limit. A non-finite `current` is treated as the default.
 */
export function stepZoomLevel(
    current: number,
    action: ZoomLevelAction
): number {
    if (action === 'reset') {
        return ZOOM_LEVEL_DEFAULT;
    }

    const base = Number.isFinite(current) ? current : ZOOM_LEVEL_DEFAULT;
    const direction = action === 'in' ? 1 : -1;

    if (direction > 0 ? base >= ZOOM_LEVEL_MAX : base <= ZOOM_LEVEL_MIN) {
        return base;
    }

    const steps = base / ZOOM_LEVEL_STEP;
    // A level between grid points steps to the next grid point in the
    // requested direction instead of skipping past it.
    const nextSteps = Number.isInteger(steps)
        ? steps + direction
        : direction > 0
          ? Math.ceil(steps)
          : Math.floor(steps);

    return clampZoomLevel(nextSteps * ZOOM_LEVEL_STEP);
}

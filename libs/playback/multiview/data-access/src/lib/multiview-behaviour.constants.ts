import type {
    MultiviewLayout,
    MultiviewPipGeometry,
} from './multiview-session.model';

/**
 * Behaviour switches of spec 5.4. Hard-coded on in phases 1–3; kept as named
 * constants so a Settings toggle can replace them without a refactor.
 */

/** A VOD or episode tile without audio is paused at its position (R4). */
export const PAUSE_VOD_WITHOUT_AUDIO = true;

/**
 * Live tiles without audio stop while the session is minimised to the
 * mini-player, freeing provider connections. Read from phase 3 on.
 */
export const STOP_MUTED_LIVE_WHEN_MINIMISED = true;

/** Most tiles a layout can show; "add" beyond it replaces a tile (R6). */
export const MULTIVIEW_LAYOUT_CAPACITY: Readonly<
    Record<MultiviewLayout, number>
> = {
    pip: 2,
    split: 2,
    grid: 4,
    focus: 4,
};

/** Layouts a session may switch to in this phase. */
export const MULTIVIEW_AVAILABLE_LAYOUTS: readonly MultiviewLayout[] = ['pip'];

/** A new PiP tile sits bottom-right at the default width (R1, L1). */
export const DEFAULT_PIP_GEOMETRY: MultiviewPipGeometry = {
    corner: 'bottom-right',
    width: null,
};

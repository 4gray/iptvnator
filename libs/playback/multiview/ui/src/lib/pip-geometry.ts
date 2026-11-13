import type {
    MultiviewPipGeometry,
    MultiviewSessionState,
} from '@iptvnator/playback/multiview/data-access';

/** Space between the PiP tile and the stage edge (L1). */
export const PIP_INSET = 16;
/** Bottom corners keep clear of the main tile's control dock (L1). */
export const PIP_DOCK_CLEARANCE = 96;
export const PIP_WIDTH_RATIO = 0.3;
export const PIP_MIN_WIDTH = 240;
export const PIP_MAX_WIDTH = 480;
const ASPECT = 16 / 9;

export interface StageSize {
    readonly width: number;
    readonly height: number;
}

export interface TileBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export type TileRole = 'main' | 'pip';

export interface TilePlacement {
    readonly box: TileBox;
    readonly role: TileRole;
}

/**
 * The PiP tile (L1): 16:9, 30 % of the stage width by default or the width
 * the viewer chose, clamped to 240–480 px and to what fits, snapped to a
 * corner with a 16 px inset; bottom corners sit above the dock.
 */
export function pipBox(
    stage: StageSize,
    geometry: MultiviewPipGeometry
): TileBox {
    const preferred = geometry.width ?? stage.width * PIP_WIDTH_RATIO;
    const fitWidth = stage.width - 2 * PIP_INSET;
    const fitHeight = stage.height - 2 * PIP_INSET - PIP_DOCK_CLEARANCE;
    const largest = Math.min(PIP_MAX_WIDTH, fitWidth, fitHeight * ASPECT);
    const width = Math.max(
        0,
        Math.min(Math.max(preferred, PIP_MIN_WIDTH), largest)
    );
    const height = width / ASPECT;
    const left = geometry.corner.endsWith('left')
        ? PIP_INSET
        : stage.width - PIP_INSET - width;
    const top = geometry.corner.startsWith('top')
        ? PIP_INSET
        : stage.height - PIP_INSET - PIP_DOCK_CLEARANCE - height;
    return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
    };
}

/** Where every tile of the session goes on a stage of this size. */
export function placeTiles(
    stage: StageSize,
    state: MultiviewSessionState
): ReadonlyMap<string, TilePlacement> {
    const placements = new Map<string, TilePlacement>();
    const [main, ...others] = state.tiles;
    if (!main) return placements;
    placements.set(main.id, {
        role: 'main',
        box: { left: 0, top: 0, width: stage.width, height: stage.height },
    });
    // Phase 1 has only the PiP layout, which holds one more tile.
    if (others[0]) {
        placements.set(others[0].id, {
            role: 'pip',
            box: pipBox(stage, state.pip),
        });
    }
    return placements;
}

/**
 * Render order of the tiles: the order they were created in, never the
 * session order. Moving a playing `<video>` in the DOM pauses it, so a swap
 * may change where a tile is drawn but never its place among its siblings.
 */
export function stableTileOrder(
    previous: readonly string[],
    tileIds: readonly string[]
): readonly string[] {
    const present = new Set(tileIds);
    const kept = previous.filter((id) => present.has(id));
    const added = tileIds.filter((id) => !kept.includes(id));
    const next = [...kept, ...added];
    return next.length === previous.length &&
        next.every((id, index) => id === previous[index])
        ? previous
        : next;
}

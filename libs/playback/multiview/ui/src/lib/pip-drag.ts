import type { MultiviewPipCorner } from '@iptvnator/playback/multiview/data-access';
import type { StageSize, TileBox } from './pip-geometry';

/** Width change per resize keystroke, in CSS pixels. */
export const PIP_KEYBOARD_RESIZE_STEP = 40;

/** The corner a PiP tile snaps to: the stage quadrant its centre is in. */
export function nearestCorner(
    stage: StageSize,
    box: TileBox
): MultiviewPipCorner {
    const vertical =
        box.top + box.height / 2 < stage.height / 2 ? 'top' : 'bottom';
    const horizontal =
        box.left + box.width / 2 < stage.width / 2 ? 'left' : 'right';
    return `${vertical}-${horizontal}`;
}

/** The tile corner facing the stage centre, where its resize handle is (L1). */
export function resizeHandleCorner(
    corner: MultiviewPipCorner
): MultiviewPipCorner {
    const [vertical, horizontal] = corner.split('-');
    return `${vertical === 'top' ? 'bottom' : 'top'}-${
        horizontal === 'left' ? 'right' : 'left'
    }` as MultiviewPipCorner;
}

/**
 * New width after dragging the handle by (dx, dy). The handle faces the
 * centre, so moving it towards the centre grows the tile; the larger of the
 * two movements (height scaled to 16:9) wins.
 */
export function resizedWidth(
    corner: MultiviewPipCorner,
    startWidth: number,
    dx: number,
    dy: number
): number {
    const growX = corner.endsWith('right') ? -dx : dx;
    const growY = (corner.startsWith('bottom') ? -dy : dy) * (16 / 9);
    const grow = Math.abs(growX) >= Math.abs(growY) ? growX : growY;
    return Math.max(0, Math.round(startWidth + grow));
}

/** The corner an arrow key moves the tile to, or null at the edge. */
export function cornerAfterArrow(
    corner: MultiviewPipCorner,
    key: string
): MultiviewPipCorner | null {
    const [vertical, horizontal] = corner.split('-');
    const next =
        key === 'ArrowUp'
            ? `top-${horizontal}`
            : key === 'ArrowDown'
              ? `bottom-${horizontal}`
              : key === 'ArrowLeft'
                ? `${vertical}-left`
                : key === 'ArrowRight'
                  ? `${vertical}-right`
                  : null;
    return next && next !== corner ? (next as MultiviewPipCorner) : null;
}

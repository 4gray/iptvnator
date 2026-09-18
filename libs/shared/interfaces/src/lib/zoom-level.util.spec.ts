import {
    clampZoomLevel,
    stepZoomLevel,
    ZOOM_LEVEL_MAX,
    ZOOM_LEVEL_MIN,
    ZOOM_LEVEL_STEP,
} from './zoom-level.util';

describe('zoom level shortcuts contract', () => {
    it('steps by the Electron menu-role step in both directions', () => {
        expect(stepZoomLevel(0, 'in')).toBe(ZOOM_LEVEL_STEP);
        expect(stepZoomLevel(0, 'out')).toBe(-ZOOM_LEVEL_STEP);
        expect(stepZoomLevel(1, 'in')).toBe(1.5);
        expect(stepZoomLevel(-1.5, 'out')).toBe(-2);
    });

    it('resets to the default level from anywhere', () => {
        expect(stepZoomLevel(3, 'reset')).toBe(0);
        expect(stepZoomLevel(-2.5, 'reset')).toBe(0);
        expect(stepZoomLevel(Number.NaN, 'reset')).toBe(0);
    });

    it('clamps at the app limits, not at Chromium limits', () => {
        expect(stepZoomLevel(ZOOM_LEVEL_MAX, 'in')).toBe(ZOOM_LEVEL_MAX);
        expect(stepZoomLevel(ZOOM_LEVEL_MIN, 'out')).toBe(ZOOM_LEVEL_MIN);
        expect(stepZoomLevel(ZOOM_LEVEL_MAX + 3, 'in')).toBe(ZOOM_LEVEL_MAX);
        expect(stepZoomLevel(ZOOM_LEVEL_MAX + 3, 'out')).toBe(
            ZOOM_LEVEL_MAX - ZOOM_LEVEL_STEP
        );
        expect(clampZoomLevel(ZOOM_LEVEL_MIN - 1)).toBe(ZOOM_LEVEL_MIN);
    });

    it('snaps an off-grid level to the next grid point in the requested direction', () => {
        // A level the macOS menu roles or an older store left between steps.
        expect(stepZoomLevel(0.3, 'in')).toBe(0.5);
        expect(stepZoomLevel(0.3, 'out')).toBe(0);
        expect(stepZoomLevel(-0.7, 'out')).toBe(-1);
        expect(stepZoomLevel(-0.7, 'in')).toBe(-0.5);
    });

    it('treats a non-finite level as the default', () => {
        expect(stepZoomLevel(Number.NaN, 'in')).toBe(ZOOM_LEVEL_STEP);
        expect(stepZoomLevel(Number.POSITIVE_INFINITY, 'out')).toBe(
            -ZOOM_LEVEL_STEP
        );
        expect(clampZoomLevel(Number.NaN)).toBe(0);
    });
});

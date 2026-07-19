import { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';
import {
    NativeViewBoundsContext,
    toNativeViewBounds,
} from './embedded-mpv-bounds.util';

const CSS_BOUNDS: EmbeddedMpvBounds = { x: 372, y: 60, width: 578, height: 330 };

function context(
    overrides: Partial<NativeViewBoundsContext> = {}
): NativeViewBoundsContext {
    return {
        platform: 'linux',
        zoomFactor: 1,
        displayScaleFactor: 1,
        ...overrides,
    };
}

describe('toNativeViewBounds', () => {
    it('returns the input untouched at 100% zoom and 100% display scale', () => {
        const result = toNativeViewBounds(CSS_BOUNDS, context());

        expect(result).toBe(CSS_BOUNDS);
    });

    // Regression for #1145: CSS bounds were handed to XMoveResizeWindow as-is,
    // so on a 140%-scaled Linux Mint desktop the mpv window landed at ~71% of
    // the expected position and size, toward the window's top-left corner.
    it('scales linux bounds by the display scale factor', () => {
        const result = toNativeViewBounds(
            CSS_BOUNDS,
            context({ platform: 'linux', displayScaleFactor: 1.4 })
        );

        expect(result).toEqual({ x: 521, y: 84, width: 809, height: 462 });
    });

    it('scales win32 bounds by the display scale factor', () => {
        const result = toNativeViewBounds(
            { x: 100, y: 50, width: 640, height: 360 },
            context({ platform: 'win32', displayScaleFactor: 1.25 })
        );

        expect(result).toEqual({ x: 125, y: 63, width: 800, height: 450 });
    });

    it('combines page zoom with the display scale factor', () => {
        const result = toNativeViewBounds(
            { x: 100, y: 50, width: 640, height: 360 },
            context({
                platform: 'win32',
                zoomFactor: 1.2,
                displayScaleFactor: 1.5,
            })
        );

        expect(result).toEqual({ x: 180, y: 90, width: 1152, height: 648 });
    });

    it('ignores the display scale on macOS (NSView frames are in points)', () => {
        const result = toNativeViewBounds(
            CSS_BOUNDS,
            context({ platform: 'darwin', displayScaleFactor: 2 })
        );

        expect(result).toBe(CSS_BOUNDS);
    });

    it('applies page zoom on macOS', () => {
        const result = toNativeViewBounds(
            { x: 100, y: 50, width: 640, height: 360 },
            context({
                platform: 'darwin',
                zoomFactor: 1.5,
                displayScaleFactor: 2,
            })
        );

        expect(result).toEqual({ x: 150, y: 75, width: 960, height: 540 });
    });

    it('rounds fractional CSS edges only after scaling', () => {
        // A 10.49px CSS edge at 200% renders at 21 physical pixels; edges
        // rounded before scaling would send 20 and shift the video by 1px.
        const result = toNativeViewBounds(
            { x: 10.49, y: 0.5, width: 100.02, height: 50 },
            context({ platform: 'win32', displayScaleFactor: 2 })
        );

        expect(result).toEqual({ x: 21, y: 1, width: 200, height: 100 });
    });

    it('keeps vertically adjacent rects seamless under fractional scales', () => {
        // 42 × 1.25 and 153 × 1.25 both land on .5/.25 fractions: rounding
        // x/y/width/height independently would misplace the shared edge by
        // 1px, while edge-based rounding keeps the rects flush.
        const scale = context({ displayScaleFactor: 1.25 });
        const upper = toNativeViewBounds(
            { x: 0, y: 42, width: 500, height: 111 },
            scale
        );
        const lower = toNativeViewBounds(
            { x: 0, y: 153, width: 500, height: 90 },
            scale
        );

        expect(upper.y + upper.height).toBe(lower.y);
    });

    it('keeps hidden bounds offscreen and at least 1x1', () => {
        const result = toNativeViewBounds(
            { x: -100000, y: -100000, width: 1, height: 1 },
            context({ displayScaleFactor: 1.5 })
        );

        expect(result.x).toBeLessThanOrEqual(-100000);
        expect(result.y).toBeLessThanOrEqual(-100000);
        expect(result.width).toBeGreaterThanOrEqual(1);
        expect(result.height).toBeGreaterThanOrEqual(1);
    });

    it('treats non-finite or non-positive factors as 100%', () => {
        for (const zoomFactor of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
            expect(
                toNativeViewBounds(
                    CSS_BOUNDS,
                    context({ zoomFactor, displayScaleFactor: zoomFactor })
                )
            ).toBe(CSS_BOUNDS);
        }
    });
});

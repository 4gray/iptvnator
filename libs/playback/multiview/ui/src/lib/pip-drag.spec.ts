import {
    cornerAfterArrow,
    nearestCorner,
    resizedWidth,
    resizeHandleCorner,
} from './pip-drag';

const STAGE = { width: 1280, height: 720 };

describe('nearestCorner', () => {
    it.each([
        [{ left: 10, top: 10, width: 300, height: 169 }, 'top-left'],
        [{ left: 900, top: 10, width: 300, height: 169 }, 'top-right'],
        [{ left: 10, top: 500, width: 300, height: 169 }, 'bottom-left'],
        [{ left: 900, top: 500, width: 300, height: 169 }, 'bottom-right'],
    ] as const)('snaps %o to %s', (box, corner) => {
        expect(nearestCorner(STAGE, box)).toBe(corner);
    });
});

describe('resizeHandleCorner', () => {
    it.each([
        ['bottom-right', 'top-left'],
        ['top-left', 'bottom-right'],
        ['top-right', 'bottom-left'],
        ['bottom-left', 'top-right'],
    ] as const)('puts the handle of a %s tile at its %s', (corner, handle) => {
        expect(resizeHandleCorner(corner)).toBe(handle);
    });
});

describe('resizedWidth', () => {
    it('grows a bottom-right tile when its handle moves up-left', () => {
        expect(resizedWidth('bottom-right', 300, -60, -10)).toBe(360);
    });

    it('shrinks a top-left tile when its handle moves up-left', () => {
        expect(resizedWidth('top-left', 300, -60, 0)).toBe(240);
    });

    it('follows a mostly vertical drag at 16:9', () => {
        expect(resizedWidth('bottom-right', 300, 0, -36)).toBe(364);
    });

    it('never goes below zero', () => {
        expect(resizedWidth('bottom-right', 100, 400, 0)).toBe(0);
    });
});

describe('cornerAfterArrow', () => {
    it.each([
        ['bottom-right', 'ArrowUp', 'top-right'],
        ['bottom-right', 'ArrowLeft', 'bottom-left'],
        ['top-left', 'ArrowDown', 'bottom-left'],
        ['top-left', 'ArrowRight', 'top-right'],
    ] as const)('moves %s with %s to %s', (corner, key, next) => {
        expect(cornerAfterArrow(corner, key)).toBe(next);
    });

    it.each([
        ['bottom-right', 'ArrowDown'],
        ['top-left', 'ArrowLeft'],
        ['top-left', 'Enter'],
    ] as const)('stays at %s for %s', (corner, key) => {
        expect(cornerAfterArrow(corner, key)).toBeNull();
    });
});

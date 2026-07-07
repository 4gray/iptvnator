import { measureBounds } from './embedded-mpv-compositor';

function createHost(rect: Partial<DOMRect>): HTMLElement {
    return {
        getBoundingClientRect: () =>
            ({
                left: 0,
                top: 0,
                width: 800,
                height: 600,
                ...rect,
            }) as DOMRect,
    } as HTMLElement;
}

describe('embedded MPV compositor', () => {
    it('measures the full host viewport (always full-bleed)', () => {
        expect(measureBounds(createHost({ height: 600 }))).toEqual({
            x: 0,
            y: 0,
            width: 800,
            height: 600,
        });
    });

    it('rounds host bounds and keeps minimum native view dimensions', () => {
        const host = createHost({
            left: 10.4,
            top: 20.6,
            width: 0,
            height: 0.2,
        });

        expect(measureBounds(host)).toEqual({
            x: 10,
            y: 21,
            width: 1,
            height: 1,
        });
    });
});

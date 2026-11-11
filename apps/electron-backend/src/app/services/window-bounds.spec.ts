import { resolveVisibleWindowBounds } from './window-bounds';

describe('resolveVisibleWindowBounds', () => {
    it('returns undefined when there are no saved bounds', () => {
        expect(
            resolveVisibleWindowBounds(undefined, [
                { x: 0, y: 0, width: 1920, height: 1080 },
            ])
        ).toBeUndefined();
    });

    it('keeps saved bounds that overlap a connected display', () => {
        const savedBounds = { x: 100, y: 100, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
            ])
        ).toBe(savedBounds);
    });

    it('keeps saved bounds that land on a secondary display', () => {
        const savedBounds = { x: 2020, y: 100, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
                { x: 1920, y: 0, width: 1920, height: 1080 },
            ])
        ).toBe(savedBounds);
    });

    it('drops bounds left entirely on a now-disconnected monitor', () => {
        // Secondary monitor used to sit to the right; only the primary
        // display remains after it was unplugged.
        const savedBounds = { x: 2020, y: 100, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
            ])
        ).toBeUndefined();
    });

    it('drops bounds with only a sliver still on a connected display', () => {
        // Window mostly off to the left of the primary display, 20px peeking in.
        const savedBounds = { x: -1260, y: 100, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
            ])
        ).toBeUndefined();
    });

    it('keeps bounds with enough overlap even if partially off-screen', () => {
        const savedBounds = { x: -100, y: 100, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
            ])
        ).toBe(savedBounds);
    });

    it('drops bounds when only the bottom of the window remains visible', () => {
        const savedBounds = { x: 100, y: -600, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
            ])
        ).toBeUndefined();
    });

    it('keeps negative vertical bounds on a connected upper display', () => {
        const savedBounds = { x: 100, y: -600, width: 1280, height: 720 };

        expect(
            resolveVisibleWindowBounds(savedBounds, [
                { x: 0, y: 0, width: 1920, height: 1080 },
                { x: 0, y: -1080, width: 1920, height: 1080 },
            ])
        ).toBe(savedBounds);
    });

    it('drops bounds when no displays are reported', () => {
        const savedBounds = { x: 100, y: 100, width: 1280, height: 720 };

        expect(resolveVisibleWindowBounds(savedBounds, [])).toBeUndefined();
    });
});

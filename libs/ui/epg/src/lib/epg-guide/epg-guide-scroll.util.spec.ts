import {
    guideBlockRevealScrollLeft,
    guideNowScrollLeft,
    guideRowNeedsReveal,
    scrollElementLeft,
} from './epg-guide-scroll.util';

function block(leftPx: number, widthPx: number) {
    return { leftPx, widthPx };
}

describe('guideNowScrollLeft', () => {
    it('puts the now-line a third into the visible lane', () => {
        // 1100 - 200 = 900 visible, a third of it is 300.
        expect(guideNowScrollLeft(1100, 900, 200)).toBe(600);
    });

    it('never scrolls before the start of the track', () => {
        expect(guideNowScrollLeft(1000, 100, 200)).toBe(0);
    });

    it('survives a viewport narrower than the channel column', () => {
        expect(guideNowScrollLeft(100, 500, 200)).toBe(500);
    });
});

describe('guideRowNeedsReveal', () => {
    it('is false for a row fully inside the viewport', () => {
        expect(guideRowNeedsReveal(3, 60, 100, 400)).toBe(false);
    });

    it('is true for a row above the viewport', () => {
        expect(guideRowNeedsReveal(1, 60, 100, 400)).toBe(true);
    });

    it('is true for a row only partly below the bottom edge', () => {
        // Row 8 spans 480–540, the viewport ends at 100 + 400 = 500.
        expect(guideRowNeedsReveal(8, 60, 100, 400)).toBe(true);
        // Row 7 spans 420–480 and still fits.
        expect(guideRowNeedsReveal(7, 60, 100, 400)).toBe(false);
    });

    it('treats a row flush with either edge as visible', () => {
        expect(guideRowNeedsReveal(2, 50, 100, 400)).toBe(false);
        expect(guideRowNeedsReveal(9, 50, 100, 400)).toBe(false);
    });
});

describe('guideBlockRevealScrollLeft', () => {
    it('returns null while the block is fully visible', () => {
        expect(guideBlockRevealScrollLeft(block(300, 100), 200, 800, 200)).toBe(
            null
        );
    });

    it('scrolls back with padding for a block left of the lane', () => {
        expect(guideBlockRevealScrollLeft(block(300, 100), 500, 800, 200)).toBe(
            260
        );
    });

    it('scrolls forward for a block that overflows the right edge', () => {
        // Visible lane is 600 wide, so 100..900 ends past 0 + 600.
        expect(guideBlockRevealScrollLeft(block(100, 800), 0, 800, 200)).toBe(
            60
        );
    });

    it('clamps the target to the start of the track', () => {
        expect(guideBlockRevealScrollLeft(block(10, 50), 200, 800, 200)).toBe(
            0
        );
    });
});

describe('scrollElementLeft', () => {
    it('uses scrollTo when the element implements it', () => {
        const scrollTo = jest.fn();
        const element = { scrollTo, scrollLeft: 0 } as unknown as HTMLElement;
        scrollElementLeft(element, 120, true);
        expect(scrollTo).toHaveBeenCalledWith({
            left: 120,
            behavior: 'smooth',
        });
        scrollElementLeft(element, 10, false);
        expect(scrollTo).toHaveBeenLastCalledWith({
            left: 10,
            behavior: 'auto',
        });
    });

    it('falls back to assigning scrollLeft (jsdom has no scrollTo)', () => {
        const element = { scrollLeft: 0 } as unknown as HTMLElement;
        scrollElementLeft(element, 42, true);
        expect(element.scrollLeft).toBe(42);
    });
});

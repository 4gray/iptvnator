import {
    clampOverflowCount,
    HEADER_OVERFLOW_HYSTERESIS_PX,
    HeaderOverflowGeometry,
    headerOverflowSavings,
    resolveHeaderOverflowCount,
} from './workspace-shell-header-overflow';

const SLOT = 44;
/** Layout, rail toggle and lock are contextual; Add source is global. */
const GEOMETRY: HeaderOverflowGeometry = {
    slot: SLOT,
    contextual: 3,
    groupSlack: 17,
};

function resolve(spare: number, current: number, candidates = 4): number {
    return resolveHeaderOverflowCount({
        ...GEOMETRY,
        candidates,
        spare,
        current,
    });
}

describe('header overflow planning', () => {
    it('keeps every action inline while there is room', () => {
        expect(resolve(0, 0)).toBe(0);
    });

    it('moves at least two actions, since one would free no room', () => {
        // One pixel short: hiding one action and adding the menu saves
        // nothing, so two go.
        expect(resolve(-1, 0)).toBe(2);
        expect(headerOverflowSavings(1, GEOMETRY)).toBe(0);
        expect(headerOverflowSavings(2, GEOMETRY)).toBe(SLOT);
    });

    it('moves as many as the shortfall needs', () => {
        expect(resolve(-(SLOT + 1), 0)).toBe(3);
    });

    it('counts the divider and gap that leave with the contextual group', () => {
        expect(headerOverflowSavings(3, GEOMETRY)).toBe(2 * SLOT + 17);
        // Without contextual actions there is no group to lose.
        expect(
            headerOverflowSavings(2, { ...GEOMETRY, contextual: 0 })
        ).toBe(SLOT);
    });

    it('moves everything when even that does not fit', () => {
        expect(resolve(-1000, 0, 3)).toBe(3);
    });

    it('never builds a menu for a single candidate', () => {
        expect(resolve(-1000, 0, 1)).toBe(0);
        expect(clampOverflowCount(1, 4)).toBe(0);
        expect(clampOverflowCount(3, 2)).toBe(2);
    });

    it('reads the spare room of a header that already overflows', () => {
        // Two actions in the menu freed one slot; the same header with all
        // inline would be 10px short, so the plan holds.
        expect(resolve(SLOT - 10, 2)).toBe(2);
    });

    it('brings actions back only with room to spare', () => {
        expect(resolve(SLOT + HEADER_OVERFLOW_HYSTERESIS_PX - 1, 2)).toBe(2);
        expect(resolve(SLOT + HEADER_OVERFLOW_HYSTERESIS_PX, 2)).toBe(0);
    });

    it('settles on one plan at every width across the cutoff', () => {
        // A header whose contextual group is just the two moved actions:
        // moving both also removes the gap and divider, as the real layout
        // does. Each width is measured repeatedly, as the ResizeObserver
        // would after every plan change.
        const geometry = { slot: SLOT, contextual: 2, groupSlack: 17 };
        const freed = (count: number) =>
            headerOverflowSavings(count, geometry);

        for (let inlineSpare = -60; inlineSpare <= 60; inlineSpare++) {
            const plans: number[] = [];
            let current = 0;
            for (let pass = 0; pass < 4; pass++) {
                current = resolveHeaderOverflowCount({
                    ...geometry,
                    candidates: 3,
                    spare: inlineSpare + freed(current),
                    current,
                });
                plans.push(current);
            }
            expect(new Set(plans.slice(1)).size).toBe(1);
        }
    });
});

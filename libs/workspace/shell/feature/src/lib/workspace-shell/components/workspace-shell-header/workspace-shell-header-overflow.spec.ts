import {
    clampOverflowCount,
    HEADER_OVERFLOW_HYSTERESIS_PX,
    headerOverflowSavings,
    resolveHeaderOverflowCount,
} from './workspace-shell-header-overflow';

const SLOT = 44;

describe('header overflow planning', () => {
    it('keeps every action inline while there is room', () => {
        expect(
            resolveHeaderOverflowCount({
                candidates: 4,
                spare: 0,
                slot: SLOT,
                current: 0,
            })
        ).toBe(0);
    });

    it('moves at least two actions, since one would free no room', () => {
        // One pixel short: hiding one action and adding the menu saves
        // nothing, so two go.
        expect(
            resolveHeaderOverflowCount({
                candidates: 4,
                spare: -1,
                slot: SLOT,
                current: 0,
            })
        ).toBe(2);
        expect(headerOverflowSavings(1, SLOT)).toBe(0);
        expect(headerOverflowSavings(2, SLOT)).toBe(SLOT);
    });

    it('moves as many as the shortfall needs', () => {
        expect(
            resolveHeaderOverflowCount({
                candidates: 4,
                spare: -(SLOT + 1),
                slot: SLOT,
                current: 0,
            })
        ).toBe(3);
    });

    it('moves everything when even that does not fit', () => {
        expect(
            resolveHeaderOverflowCount({
                candidates: 3,
                spare: -1000,
                slot: SLOT,
                current: 0,
            })
        ).toBe(3);
    });

    it('never builds a menu for a single candidate', () => {
        expect(
            resolveHeaderOverflowCount({
                candidates: 1,
                spare: -1000,
                slot: SLOT,
                current: 0,
            })
        ).toBe(0);
        expect(clampOverflowCount(1, 4)).toBe(0);
        expect(clampOverflowCount(3, 2)).toBe(2);
    });

    it('reads the spare room of a header that already overflows', () => {
        // Two actions in the menu freed one slot; the same header with all
        // inline would be 10px short, so the plan holds.
        expect(
            resolveHeaderOverflowCount({
                candidates: 4,
                spare: SLOT - 10,
                slot: SLOT,
                current: 2,
            })
        ).toBe(2);
    });

    it('brings actions back only with room to spare', () => {
        const justEnough = {
            candidates: 4,
            slot: SLOT,
            current: 2,
        };
        expect(
            resolveHeaderOverflowCount({
                ...justEnough,
                spare: SLOT + HEADER_OVERFLOW_HYSTERESIS_PX - 1,
            })
        ).toBe(2);
        expect(
            resolveHeaderOverflowCount({
                ...justEnough,
                spare: SLOT + HEADER_OVERFLOW_HYSTERESIS_PX,
            })
        ).toBe(0);
    });
});

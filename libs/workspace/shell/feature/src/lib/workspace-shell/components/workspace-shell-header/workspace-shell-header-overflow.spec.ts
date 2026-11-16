import {
    clampOverflowCount,
    HEADER_OVERFLOW_HYSTERESIS_PX,
    HeaderOverflowGeometry,
    headerOverflowSavings,
    headerSearchComfortWidth,
    measureHeaderActionSlot,
    measureHeaderGroupSlack,
    measureHeaderSpare,
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
        expect(headerOverflowSavings(2, { ...GEOMETRY, contextual: 0 })).toBe(
            SLOT
        );
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
        const freed = (count: number) => headerOverflowSavings(count, geometry);

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

describe('header overflow measurement', () => {
    /** jsdom has no layout: each element gets its box and computed style. */
    const boxes = new Map<Element, { width: number; hidden?: boolean }>();
    const styles = new Map<Element, Partial<CSSStyleDeclaration>>();

    function el(
        tag: string,
        width: number,
        style: Partial<CSSStyleDeclaration> = {},
        className = '',
        hidden = false
    ): HTMLElement {
        const element = document.createElement(tag);
        element.className = className;
        boxes.set(element, { width, hidden });
        styles.set(element, style);
        return element;
    }

    beforeEach(() => {
        jest.spyOn(window, 'getComputedStyle').mockImplementation(
            (element: Element) =>
                ({
                    paddingLeft: '',
                    paddingRight: '',
                    columnGap: '',
                    flexBasis: 'auto',
                    paddingInlineStart: '',
                    borderInlineStartWidth: '',
                    ...styles.get(element),
                }) as CSSStyleDeclaration
        );
        jest.spyOn(
            HTMLElement.prototype,
            'offsetWidth',
            'get'
        ).mockImplementation(function (this: HTMLElement) {
            return boxes.get(this)?.width ?? 0;
        });
        jest.spyOn(
            HTMLElement.prototype,
            'clientWidth',
            'get'
        ).mockImplementation(function (this: HTMLElement) {
            return boxes.get(this)?.width ?? 0;
        });
        jest.spyOn(Element.prototype, 'getClientRects').mockImplementation(
            function (this: Element) {
                const box = boxes.get(this);
                return (box && !box.hidden
                    ? [{}]
                    : []) as unknown as DOMRectList;
            }
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
        boxes.clear();
        styles.clear();
    });

    it('sizes the search field by the header width', () => {
        expect(headerSearchComfortWidth(375)).toBe(120);
        expect(headerSearchComfortWidth(640)).toBe(120);
        expect(headerSearchComfortWidth(900)).toBe(220);
    });

    it('subtracts every visible region, gap and padding from the row', () => {
        const header = el('header', 900, {
            paddingLeft: '12px',
            paddingRight: '12px',
            columnGap: '10px',
        });
        const back = el('div', 40);
        // The switcher may shrink, so it counts at its flex basis.
        const switcher = el('div', 150, { flexBasis: '200px' });
        const search = el('div', 90);
        const hidden = el('div', 500, {}, '', true);
        const actions = el('div', 180);
        header.append(back, switcher, search, hidden, actions);

        // 876 content - 3 gaps of 10 - (40 + 200 + 220 + 180).
        expect(measureHeaderSpare(header, search)).toBe(876 - 30 - 640);
        // Without a search field every region counts at its own width.
        expect(measureHeaderSpare(header, null)).toBe(876 - 30 - 510);
    });

    it('measures one action slot with its group gap', () => {
        const cluster = el('div', 200);
        const group = el('div', 200, { columnGap: '4px' }, 'header-actions');
        const hiddenButton = el('button', 40, {}, '', true);
        group.append(hiddenButton, el('button', 36));
        cluster.append(group);

        expect(measureHeaderActionSlot(cluster)).toBe(40);
        expect(measureHeaderActionSlot(el('div', 0))).toBe(0);
    });

    it('measures the gap and divider that leave with the contextual group', () => {
        const cluster = el('div', 200, { columnGap: '8px' });
        const contextual = el(
            'div',
            80,
            {},
            'header-actions header-actions--contextual'
        );
        const global = el(
            'div',
            120,
            { paddingInlineStart: '8px', borderInlineStartWidth: '1px' },
            'header-actions header-actions--divided'
        );
        cluster.append(contextual, global);

        expect(measureHeaderGroupSlack(cluster)).toBe(17);

        contextual.remove();
        global.classList.remove('header-actions--divided');
        expect(measureHeaderGroupSlack(cluster)).toBeNull();
    });
});

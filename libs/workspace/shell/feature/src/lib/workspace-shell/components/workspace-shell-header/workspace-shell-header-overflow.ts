/**
 * Priority+ overflow for the workspace header: when the header lacks room,
 * low-priority actions move into a "More actions" menu. Back, the source
 * switcher, search and downloads never move.
 */
export type HeaderOverflowItemId =
    | 'layout'
    | 'sidebar'
    | 'parental-lock'
    | 'add-source';

/** Hide order, first to last. */
export const HEADER_OVERFLOW_ORDER: readonly HeaderOverflowItemId[] = [
    'layout',
    'sidebar',
    'parental-lock',
    'add-source',
];

/**
 * A menu holding one action costs the slot it frees, so it never appears
 * for fewer than two: below that the action stays inline.
 */
export const HEADER_OVERFLOW_MIN_ITEMS = 2;

/** Extra room needed before items come back, so a resize cannot flicker. */
export const HEADER_OVERFLOW_HYSTERESIS_PX = 8;

/** The width the search field needs to stay usable, by header width. */
export function headerSearchComfortWidth(headerWidth: number): number {
    return headerWidth <= 640 ? 120 : 220;
}

export interface HeaderOverflowGeometry {
    /** Width of one action button with its gap. */
    slot: number;
    /**
     * How many of the candidates are contextual. They come first in the
     * hide order, so once that many have moved the contextual group is gone.
     */
    contextual: number;
    /**
     * Width that leaves with the contextual group: the gap between the two
     * groups and the divider with its padding.
     */
    groupSlack: number;
}

/** Width freed by moving `count` actions into the menu. */
export function headerOverflowSavings(
    count: number,
    geometry: HeaderOverflowGeometry
): number {
    if (count < HEADER_OVERFLOW_MIN_ITEMS) {
        return 0;
    }
    const groupGone = geometry.contextual > 0 && count >= geometry.contextual;
    return (count - 1) * geometry.slot + (groupGone ? geometry.groupSlack : 0);
}

export interface HeaderOverflowInput extends HeaderOverflowGeometry {
    /** How many actions may move, all present in the header. */
    candidates: number;
    /** Spare width as laid out now (negative when short of room). */
    spare: number;
    /** How many actions sit in the menu now. */
    current: number;
}

/**
 * How many actions belong in the menu: the fewest that make room, 0 or at
 * least {@link HEADER_OVERFLOW_MIN_ITEMS}. `spare` was measured with
 * `current` actions in the menu, so it is first turned back into the room
 * an all-inline header would have. The savings must match what the layout
 * really frees, divider included, or the header flips between two plans.
 */
export function resolveHeaderOverflowCount(input: HeaderOverflowInput): number {
    const { candidates } = input;
    if (candidates < HEADER_OVERFLOW_MIN_ITEMS || input.slot <= 0) {
        return 0;
    }

    const current = clampOverflowCount(input.current, candidates);
    const inlineSpare = input.spare - headerOverflowSavings(current, input);

    for (let count = 0; count <= candidates; count++) {
        if (count > 0 && count < HEADER_OVERFLOW_MIN_ITEMS) {
            continue;
        }
        const margin = count < current ? HEADER_OVERFLOW_HYSTERESIS_PX : 0;
        if (inlineSpare + headerOverflowSavings(count, input) >= margin) {
            return count;
        }
    }
    return candidates;
}

/** A stored count applied to the actions present now. */
export function clampOverflowCount(count: number, candidates: number): number {
    const clamped = Math.min(Math.max(count, 0), candidates);
    return clamped < HEADER_OVERFLOW_MIN_ITEMS ? 0 : clamped;
}

/**
 * Spare width of the header row: its content box minus every visible
 * region's width and gaps. The search field counts at its comfort width,
 * since it is the region that gives up room, and a region that may shrink
 * (the phone switcher) at its preferred size. Measured from layout boxes,
 * so the layout-slide transforms do not skew it.
 */
export function measureHeaderSpare(
    header: HTMLElement,
    searchField: HTMLElement | null
): number {
    const style = getComputedStyle(header);
    const content =
        header.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.columnGap) || 0;
    const regions = Array.from(header.children).filter(
        (child): child is HTMLElement =>
            child instanceof HTMLElement && child.getClientRects().length > 0
    );

    let used = gap * Math.max(0, regions.length - 1);
    for (const region of regions) {
        used +=
            region === searchField
                ? headerSearchComfortWidth(header.clientWidth)
                : preferredWidth(region);
    }
    return content - used;
}

/** Width of one action button plus its group's gap, or 0 when none shows. */
export function measureHeaderActionSlot(actions: HTMLElement): number {
    const button = Array.from(actions.querySelectorAll('button')).find(
        (candidate) => candidate.getClientRects().length > 0
    );
    if (!button) {
        return 0;
    }
    const group = button.closest('.header-actions') ?? actions;
    const gap = parseFloat(getComputedStyle(group).columnGap) || 0;
    return button.offsetWidth + gap;
}

/**
 * Width the contextual group takes beyond its buttons: the gap after it
 * and the divider with its padding on the global group. Null while the
 * group is not rendered, since there is nothing to measure.
 */
export function measureHeaderGroupSlack(actions: HTMLElement): number | null {
    const global = actions.querySelector<HTMLElement>('.header-actions--divided');
    if (!global || !actions.querySelector('.header-actions--contextual')) {
        return null;
    }
    const clusterStyle = getComputedStyle(actions);
    const globalStyle = getComputedStyle(global);
    return (
        (parseFloat(clusterStyle.columnGap) || 0) +
        (parseFloat(globalStyle.paddingInlineStart) || 0) +
        (parseFloat(globalStyle.borderInlineStartWidth) || 0)
    );
}

function preferredWidth(region: HTMLElement): number {
    const basis = parseFloat(getComputedStyle(region).flexBasis);
    return Number.isFinite(basis)
        ? Math.max(region.offsetWidth, basis)
        : region.offsetWidth;
}

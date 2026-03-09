export type RemoteChannelDirection = 'up' | 'down';

/**
 * Returns the adjacent item in the list for remote channel navigation.
 * Uses wraparound when reaching the start or end of the list.
 */
export function getAdjacentChannelItem<T>(
    items: T[],
    activeId: string | number | null | undefined,
    direction: RemoteChannelDirection,
    getId: (item: T) => string | number | null | undefined
): T | null {
    if (!Array.isArray(items) || items.length === 0 || activeId == null) {
        return null;
    }

    const activeIdAsString = String(activeId);
    const currentIndex = items.findIndex((item) => {
        const itemId = getId(item);
        return itemId != null && String(itemId) === activeIdAsString;
    });

    if (currentIndex === -1) {
        return null;
    }

    const length = items.length;
    const nextIndex =
        direction === 'up'
            ? (currentIndex - 1 + length) % length
            : (currentIndex + 1) % length;

    return items[nextIndex] ?? null;
}

/**
 * Returns the Nth item in a list (1-based index), or null if out of range.
 */
export function getChannelItemByNumber<T>(
    items: T[],
    channelNumber: number
): T | null {
    if (
        !Array.isArray(items) ||
        items.length === 0 ||
        !Number.isFinite(channelNumber)
    ) {
        return null;
    }

    const index = Math.floor(channelNumber) - 1;
    if (index < 0 || index >= items.length) {
        return null;
    }

    return items[index] ?? null;
}

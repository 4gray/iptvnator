type ItemKind = 'value' | 'id' | 'position';
const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item);

/** Replay only explicit page edits on the archive target, never untouched remote merges. */
export function applyExplicitRestoreListEdits(
    target: unknown[],
    before: unknown[],
    after: unknown[],
    kind: ItemKind
): unknown[] {
    const key = (item: unknown): string => {
        if (record(item)) {
            if (kind === 'id') return String(item['id']);
            if (kind === 'position')
                return `${item['contentType']}:${item['contentXtreamId']}`;
        }
        return JSON.stringify(item) ?? String(item);
    };
    const was = new Map(before.map((item) => [key(item), item]));
    const now = new Map(after.map((item) => [key(item), item]));
    const result = target.filter(
        (item) => !(was.has(key(item)) && !now.has(key(item)))
    );
    for (const [id, item] of now) {
        if (was.has(id) && JSON.stringify(was.get(id)) === JSON.stringify(item))
            continue;
        const index = result.findIndex((saved) => key(saved) === id);
        if (index < 0) result.push(item);
        else result[index] = item;
    }
    if (
        before.length === after.length &&
        JSON.stringify(before.map(key)) !== JSON.stringify(after.map(key)) &&
        [...was.keys()].every((id) => now.has(id))
    ) {
        const order = new Map(after.map((item, index) => [key(item), index]));
        result.sort(
            (a, b) =>
                (order.get(key(a)) ?? Infinity) -
                (order.get(key(b)) ?? Infinity)
        );
    }
    return result;
}

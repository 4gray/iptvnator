import type { Media, UserData } from './index';

const opaqueId = /^luma-[a-f0-9]{32}$/;
export function savedLumaItems(data: UserData): Media[] {
    const sources = new Set(data.sources.map((source) => source.id));
    return [...data.favorites, ...data.history.map((p) => p.item)].filter(
        (item) => sources.has(item.sourceId)
    );
}
export function lumaId(data: UserData, item: Media) {
    const id = data.lumaIds?.[item.id];
    return typeof id === 'string' && opaqueId.test(id) ? id : undefined;
}
/** Random handles stay local until committed; provider identities never leave the TV. */
export function withLumaIds(data: UserData): UserData {
    const ids: Record<string, string> = Object.create(null);
    const used = new Set<string>();
    let changed = false;
    for (const item of savedLumaItems(data)) {
        if (ids[item.id]) continue;
        let id = lumaId(data, item);
        if (!id || used.has(id)) {
            do {
                const bytes = crypto.getRandomValues(new Uint8Array(16));
                id =
                    'luma-' +
                    Array.from(bytes, (b) =>
                        b.toString(16).padStart(2, '0')
                    ).join('');
            } while (used.has(id));
            changed = true;
        }
        used.add(id);
        ids[item.id] = id;
    }
    if (Object.keys(data.lumaIds ?? {}).length !== used.size) changed = true;
    return changed ? { ...data, lumaIds: ids } : data;
}

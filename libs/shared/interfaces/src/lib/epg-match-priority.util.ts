/** Ordered keys for XMLTV channel matching. This is a preference, not a stream mutation. */
export type EpgMatchField = 'channel-name' | 'tvg-name' | 'tvg-id';
export type EpgMatchOrder = [EpgMatchField, EpgMatchField, EpgMatchField];

export const DEFAULT_EPG_MATCH_ORDER: EpgMatchOrder = [
    'channel-name', 'tvg-name', 'tvg-id',
];

export function normalizeEpgMatchOrder(value: unknown): EpgMatchOrder {
    if (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((v) => DEFAULT_EPG_MATCH_ORDER.includes(v)) &&
        new Set(value).size === 3
    ) {
        return [...value] as EpgMatchOrder;
    }
    return [...DEFAULT_EPG_MATCH_ORDER];
}

export interface XmltvChannelIdentity {
    id: string;
    displayName: string;
}

export interface PlaylistEpgIdentity {
    channelName?: string | null;
    tvgName?: string | null;
    tvgId?: string | null;
}

export function resolveOrderedXmltvId(
    channel: PlaylistEpgIdentity,
    epgIds: ReadonlySet<string>,
    nameMatches: ReadonlyMap<string, string>,
    order: readonly EpgMatchField[] = DEFAULT_EPG_MATCH_ORDER,
): string | null {
    for (const field of normalizeEpgMatchOrder(order)) {
        const value = (field === 'tvg-id'
            ? channel.tvgId
            : field === 'tvg-name'
                ? channel.tvgName
                : channel.channelName)?.trim();
        if (!value) continue;
        const match = field === 'tvg-id'
            ? (epgIds.has(value.toLowerCase()) ? value : null)
            : nameMatches.get(value.toLowerCase()) ?? null;
        if (match) return match;
    }
    return null;
}

export function createXmltvIdentityIndex(channels: readonly XmltvChannelIdentity[]): {
    ids: ReadonlySet<string>;
    names: ReadonlyMap<string, string>;
} {
    const ids = new Set<string>();
    const names = new Map<string, string>();
    for (const row of channels) {
        if (!row.id?.trim()) continue;
        ids.add(row.id.trim().toLowerCase());
        const name = row.displayName?.trim().toLowerCase();
        if (!name) continue;
        // FIRST EXACT: preserve the first guide record for this exact
        // (case-insensitive, whitespace-trimmed) display name. WebGrab may
        // legitimately export multiple XMLTV IDs for one display name.
        // Do not require unique programme coverage or guess via fuzzy names.
        if (!names.has(name)) names.set(name, row.id.trim());
    }
    return { ids, names };
}

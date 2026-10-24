import type { XmltvChannelIdentity } from './epg-match-priority.util';

function normalized(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Return only candidate IDs for duplicate XMLTV display names referenced by
 * the current playlist. A Set deduplicates identical IDs/imported rows.
 * No fuzzy matching or arbitrary "first" selection is performed.
 */
export function collectAmbiguousXmltvIds(
    guide: readonly XmltvChannelIdentity[],
    requestedNames?: ReadonlySet<string>,
): string[] {
    const names = new Map<string, Set<string>>();
    for (const channel of guide) {
        const name = normalized(channel.displayName ?? '');
        const id = channel.id?.trim();
        if (!name || !id || (requestedNames && !requestedNames.has(name))) {
            continue;
        }
        let ids = names.get(name);
        if (!ids) {
            ids = new Set();
            names.set(name, ids);
        }
        ids.add(id);
    }

    const out = new Set<string>();
    for (const ids of names.values()) {
        if (ids.size > 1) {
            for (const id of ids) out.add(id);
        }
    }
    return Array.from(out);
}

/**
 * A duplicated display name becomes safe to auto-map only when exactly one
 * distinct XMLTV channel ID has a programme covering the current instant.
 * Multiple active candidates, zero active candidates, and missing coverage
 * remain ambiguous and require explicit manual mapping.
 */
export function resolveUniqueActiveDuplicateNames(
    guide: readonly XmltvChannelIdentity[],
    activeIds: ReadonlySet<string>,
): Map<string, string> {
    const groups = new Map<string, Set<string>>();
    for (const channel of guide) {
        const name = normalized(channel.displayName ?? '');
        const id = channel.id?.trim();
        if (!name || !id) continue;
        let ids = groups.get(name);
        if (!ids) {
            ids = new Set<string>();
            groups.set(name, ids);
        }
        ids.add(id);
    }

    const active = new Set(Array.from(activeIds, normalized));
    const matched = new Map<string, string>();
    for (const [name, ids] of groups) {
        if (ids.size < 2) continue;
        const candidates = Array.from(ids).filter((id) =>
            active.has(normalized(id))
        );
        if (candidates.length === 1) matched.set(name, candidates[0]);
    }
    return matched;
}

import type { Channel } from '@iptvnator/shared/interfaces';
import { resolveRawChannelEpgLookupKey } from './channel-epg-lookup.util';

export interface ExactEpgChannel {
    id: string;
    displayName: string;
}

/**
 * Resolve unique, exact (case-insensitive) XMLTV display names without
 * altering M3U files or persisting mappings. Valid XMLTV IDs and user-created
 * mappings always win; ambiguous guide names or conflicting playlist keys
 * are intentionally ignored.
 */
export function buildExactEpgNameAliases(
    playlistChannels: readonly Channel[],
    epgChannels: readonly ExactEpgChannel[],
    manualMappings: Readonly<Record<string, string>> = {}
): Map<string, string> {
    const normalize = (value: string): string => value.trim().toLowerCase();
    const knownIds = new Set<string>();
    const namedIds = new Map<string, string | null>();

    for (const epg of epgChannels) {
        if (!epg.id?.trim()) continue;
        knownIds.add(normalize(epg.id));
        const name = normalize(epg.displayName ?? '');
        if (!name) continue;
        const previous = namedIds.get(name);
        if (previous === undefined) {
            namedIds.set(name, epg.id);
        } else if (previous !== epg.id) {
            namedIds.set(name, null);
        }
    }

    const proposed = new Map<string, string | null>();
    for (const channel of playlistChannels) {
        const key = resolveRawChannelEpgLookupKey(channel);
        if (
            !key ||
            knownIds.has(normalize(key)) ||
            Object.prototype.hasOwnProperty.call(manualMappings, key)
        ) {
            continue;
        }

        const candidateNames = [
            channel.tvg?.name ?? '',
            channel.name ?? '',
        ];
        let match: string | undefined;
        for (const name of candidateNames) {
            const resolved = namedIds.get(normalize(name));
            if (resolved) {
                match = resolved;
                break;
            }
        }
        if (!match) continue;

        const existing = proposed.get(key);
        if (existing === undefined) {
            proposed.set(key, match);
        } else if (existing !== match) {
            proposed.set(key, null);
        }
    }

    return new Map(
        Array.from(proposed).filter(
            (entry): entry is [string, string] => entry[1] !== null
        )
    );
}

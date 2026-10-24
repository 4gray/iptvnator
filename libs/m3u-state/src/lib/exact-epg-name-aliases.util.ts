import type { Channel, EpgMatchOrder, XmltvChannelIdentity } from '@iptvnator/shared/interfaces';
import {
    DEFAULT_EPG_MATCH_ORDER,
    createXmltvIdentityIndex,
    resolveOrderedXmltvId,
} from '@iptvnator/shared/interfaces';
import { resolveRawChannelEpgLookupKey } from './channel-epg-lookup.util';

export interface ExactEpgChannel extends XmltvChannelIdentity {}

/**
 * Pick the first *successful* XMLTV lookup in the configured field order.
 * Existing manual mappings always win, and duplicate display names are
 * intentionally left unresolved. This is a transient renderer lookup map:
 * neither M3U entries nor the imported guide are modified.
 */
export function buildExactEpgNameAliases(
    playlistChannels: readonly Channel[],
    epgChannels: readonly ExactEpgChannel[],
    manualMappings: Readonly<Record<string, string>> = {},
    order: readonly EpgMatchOrder[number][] = DEFAULT_EPG_MATCH_ORDER,
    resolvedDuplicateNames: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
    const index = createXmltvIdentityIndex(epgChannels);
    // A duplicate name may be promoted only when one XMLTV ID has actual
    // current-programme coverage. Never bypass ambiguous names by order.
    const resolvedNames = new Map(index.names);
    for (const [name, id] of resolvedDuplicateNames) {
        if (resolvedNames.get(name) === null) {
            resolvedNames.set(name, id);
        }
    }
    const proposed = new Map<string, string | null>();

    for (const channel of playlistChannels) {
        const key = resolveRawChannelEpgLookupKey(channel);
        if (!key || Object.prototype.hasOwnProperty.call(manualMappings, key)) {
            continue;
        }

        const matched = resolveOrderedXmltvId(
            {
                channelName: channel.name,
                tvgName: channel.tvg?.name,
                tvgId: channel.tvg?.id,
            },
            index.ids,
            resolvedNames,
            order,
        );
        if (!matched || matched === key) continue;

        if (!proposed.has(key)) {
            proposed.set(key, matched);
        } else if (proposed.get(key) !== matched) {
            proposed.set(key, null);
        }
    }

    return new Map(
        Array.from(proposed).filter(
            (entry): entry is [string, string] => entry[1] !== null
        )
    );
}

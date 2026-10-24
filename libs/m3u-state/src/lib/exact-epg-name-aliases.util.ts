import type { Channel, EpgMatchOrder, XmltvChannelIdentity } from '@iptvnator/shared/interfaces';
import {
    DEFAULT_EPG_MATCH_ORDER,
    createXmltvIdentityIndex,
    resolveOrderedXmltvId,
} from '@iptvnator/shared/interfaces';
import { getChannelEpgAliasKey, resolveRawChannelEpgLookupKey } from './channel-epg-lookup.util';

export interface ExactEpgChannel extends XmltvChannelIdentity {}

/**
 * Pick the first *successful* XMLTV lookup in the configured field order.
 * Existing manual mappings always win. For repeated exact XMLTV display
 * names the first entry in the imported guide channel list wins, matching
 * First Exact preference. Keys are per M3U entry, not shared tvg-id values.
 * This is a transient renderer lookup map:
 * neither M3U entries nor the imported guide are modified.
 */
export function buildExactEpgNameAliases(
    playlistChannels: readonly Channel[],
    epgChannels: readonly ExactEpgChannel[],
    manualMappings: Readonly<Record<string, string>> = {},
    order: readonly EpgMatchOrder[number][] = DEFAULT_EPG_MATCH_ORDER,
): Map<string, string> {
    const index = createXmltvIdentityIndex(epgChannels);
    const proposed = new Map<string, string>();

    for (const channel of playlistChannels) {
        const rawKey = resolveRawChannelEpgLookupKey(channel);
        // A saved mapping for the legacy raw key always overrides auto matching.
        if (!rawKey || Object.prototype.hasOwnProperty.call(manualMappings, rawKey)) {
            continue;
        }

        const matched = resolveOrderedXmltvId(
            {
                channelName: channel.name,
                tvgName: channel.tvg?.name,
                tvgId: channel.tvg?.id,
            },
            index.ids,
            index.names,
            order,
        );
        if (matched && matched !== rawKey) {
            proposed.set(getChannelEpgAliasKey(channel), matched);
        }
    }

    return proposed;
}

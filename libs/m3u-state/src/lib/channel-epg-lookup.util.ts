import { Channel } from '@iptvnator/shared/interfaces';

// Derived in the desktop renderer from imported XMLTV channel names.
// These aliases are session-only: playlists, guides and manual mappings stay untouched.
const exactEpgNameAliases = new Map<string, string>();

export function replaceExactEpgNameAliases(
    aliases: ReadonlyMap<string, string>
): void {
    exactEpgNameAliases.clear();
    for (const [key, epgChannelId] of aliases) {
        if (key.trim() && epgChannelId.trim()) {
            exactEpgNameAliases.set(key, epgChannelId);
        }
    }
}

/** Original playlist lookup key; also the key for manual EPG mappings. */
export function resolveRawChannelEpgLookupKey(
    channel: Channel | null | undefined
): string {
    return (
        channel?.tvg?.id?.trim() ||
        channel?.tvg?.name?.trim() ||
        channel?.name?.trim() ||
        ''
    );
}

export function resolveChannelEpgLookupKey(
    channel: Channel | null | undefined
): string {
    const key = resolveRawChannelEpgLookupKey(channel);
    return exactEpgNameAliases.get(key) ?? key;
}

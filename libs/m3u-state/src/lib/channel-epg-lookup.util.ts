import { signal } from '@angular/core';
import { Channel } from '@iptvnator/shared/interfaces';

// Derived in the desktop renderer from imported XMLTV channel names.
// These per-entry aliases are session-only: playlists, guides and manual mappings stay untouched.
const exactEpgNameAliases = new Map<string, string>();
const aliasRevision = signal(0);
/** Reactively signals resolved M3U EPG key changes to the active player. */
export const exactEpgNameAliasesRevision = aliasRevision.asReadonly();

export function replaceExactEpgNameAliases(
    aliases: ReadonlyMap<string, string>
): void {
    const updated = new Map<string, string>();
    for (const [key, epgChannelId] of aliases) {
        if (key.trim() && epgChannelId.trim()) {
            updated.set(key, epgChannelId);
        }
    }
    if (
        exactEpgNameAliases.size === updated.size &&
        Array.from(updated).every(([key, value]) =>
            exactEpgNameAliases.get(key) === value
        )
    ) return;

    exactEpgNameAliases.clear();
    for (const [key, value] of updated) {
        exactEpgNameAliases.set(key, value);
    }
    aliasRevision.update((revision) => revision + 1);
}

/**
 * Stable session-only per-entry identity. A provider can reuse a tvg-id across
 * HD/SD/UHD entries; it is not safe as an automatic XMLTV alias map key.
 * The identity survives NgRx cloning and also distinguishes duplicate URLs.
 * Persisted manual mappings continue using the original, raw lookup key.
 */
export function getChannelEpgAliasKey(
    channel: Channel | null | undefined
): string {
    if (!channel) return '';
    return JSON.stringify([
        channel.id ?? '',
        channel.url ?? '',
        channel.name?.trim() ?? '',
        channel.tvg?.name?.trim() ?? '',
        channel.tvg?.id?.trim() ?? '',
    ]);
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
    return exactEpgNameAliases.get(getChannelEpgAliasKey(channel)) ?? key;
}

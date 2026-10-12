import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';

/** One playlist entry of a synced user-data map, on its way to the server. */
export interface PendingEntry {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
    /** The edit this value came from; a retry never replaces a newer one. */
    readonly edit: number;
}

export function entryKey(entry: PendingEntry): string {
    return `${entry.namespace}|${entry.playlistId}`;
}

export function splitEditKey(key: string): [string, string] {
    const separator = key.indexOf('|');
    return [key.slice(0, separator), key.slice(separator + 1)];
}

export function entryPath(entry: PendingEntry): string {
    return `/user-state/${entry.namespace}/${encodeURIComponent(entry.playlistId)}`;
}

export function parseMap(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

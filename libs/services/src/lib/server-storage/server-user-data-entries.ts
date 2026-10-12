import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';

/** One playlist entry of a synced user-data map, on its way to the server. */
export interface PendingEntry {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
    /** The edit this value came from; a retry never replaces a newer one. */
    readonly edit: number;
    /** The entry as the edit found it, to replay the edit on a conflict. */
    readonly before: unknown;
    /**
     * The server version the edit is based on: a tag, `null` for an entry
     * seen absent, `undefined` when unknown (an unconditional write).
     */
    readonly tag?: string | null;
}

/** `If-Match` / `If-None-Match` for a write based on `tag`. */
export function preconditionHeaders(
    tag: string | null | undefined
): Record<string, string> {
    if (tag === undefined) {
        return {};
    }
    return tag === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${tag}"` };
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

import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';

/** One playlist entry of a synced user-data map, on its way to the server. */
export interface PendingEntry {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
    /** The edit this value came from; a retry never replaces a newer one. */
    readonly edit: number;
    /**
     * The server version `value` is based on: a tag, `null` for an entry
     * seen absent, `undefined` when unknown (an unconditional write).
     */
    readonly tag?: string | null;
    /**
     * The edits since that version, oldest first: a conflict replays them
     * on the server's value in order. Kept apart where they cannot be one
     * before → after (another tab's change in between, or a write that may
     * or may not have landed), so adding and then removing an item is
     * never a no-op.
     */
    readonly steps: readonly EditStep[];
}

/** One edit as it was made: the entry before and after it. */
export interface EditStep {
    readonly before: unknown;
    readonly after: unknown;
    /**
     * The travelling write that carries it, until that one is answered;
     * `0` once a write that carried it was lost or saved for a later page:
     * it may have landed, so a later edit never joins it.
     */
    readonly sent?: number;
}

/** Steps whose write may or may not have landed. */
export function uncertain(steps: readonly EditStep[]): EditStep[] {
    return steps.map((step) => ({ ...step, sent: 0 }));
}

/**
 * `steps` plus the edit `before` → `after`: joined with the last step when
 * it continues it, kept apart otherwise.
 */
export function addStep(
    steps: readonly EditStep[],
    before: unknown,
    after: unknown
): EditStep[] {
    const last = steps[steps.length - 1];
    if (
        last &&
        last.sent === undefined &&
        JSON.stringify(last.after) === JSON.stringify(before)
    ) {
        return [...steps.slice(0, -1), { before: last.before, after }];
    }
    return [...steps, { before, after }];
}

/**
 * A version no entry ever has: a write based on what the cache shows but
 * the server may not have (another tab's unsent change) always conflicts
 * and is replayed on the server's value.
 */
export const UNKNOWN_TAG = '~unknown';

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

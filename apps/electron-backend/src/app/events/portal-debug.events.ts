import { BrowserWindow } from 'electron';
import { PORTAL_DEBUG_EVENT, PortalDebugEvent } from '@iptvnator/shared/interfaces';
import { environment } from '../../environments/environment';

const MAX_DEBUG_DEPTH = 6;

function sanitizePortalDebugValue(
    value: unknown,
    seen = new WeakSet<object>(),
    depth = 0
): unknown {
    if (
        value == null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (
        typeof value === 'function' ||
        typeof value === 'symbol'
    ) {
        return undefined;
    }

    if (depth >= MAX_DEBUG_DEPTH) {
        return '[MaxDepth]';
    }

    if (value instanceof Error) {
        const baseError = {
            name: value.name,
            message: value.message,
            stack: value.stack,
        } as Record<string, unknown>;

        for (const [key, entry] of Object.entries(
            value as unknown as Record<string, unknown>
        )) {
            baseError[key] = sanitizePortalDebugValue(
                entry,
                seen,
                depth + 1
            );
        }

        return baseError;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof URL) {
        return value.toString();
    }

    if (Array.isArray(value)) {
        return value.map((entry) =>
            sanitizePortalDebugValue(entry, seen, depth + 1)
        );
    }

    if (value instanceof Map) {
        return Object.fromEntries(
            [...value.entries()].map(([key, entry]) => [
                String(key),
                sanitizePortalDebugValue(entry, seen, depth + 1),
            ])
        );
    }

    if (value instanceof Set) {
        return [...value].map((entry) =>
            sanitizePortalDebugValue(entry, seen, depth + 1)
        );
    }

    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '[Circular]';
        }

        seen.add(value);

        const entries = Object.entries(value as Record<string, unknown>).map(
            ([key, entry]) => [
                key,
                sanitizePortalDebugValue(entry, seen, depth + 1),
            ]
        );

        seen.delete(value);

        return Object.fromEntries(entries);
    }

    return String(value);
}

export function sanitizePortalDebugEvent(
    event: PortalDebugEvent
): PortalDebugEvent {
    return {
        ...event,
        request: sanitizePortalDebugValue(event.request),
        response: sanitizePortalDebugValue(event.response),
        error: sanitizePortalDebugValue(event.error),
    };
}

export function emitPortalDebugEvent(event: PortalDebugEvent): void {
    if (environment.production) {
        return;
    }

    const serializedEvent = sanitizePortalDebugEvent(event);
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
        window.webContents.send(PORTAL_DEBUG_EVENT, serializedEvent);
    }
}

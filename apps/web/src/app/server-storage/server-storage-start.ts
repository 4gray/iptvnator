import { clearServerAccessToken } from '@iptvnator/services';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import type { ServerInstanceProbe } from './server-instance-probe';

/** Last instance this browser saw, per backend URL. */
export const REMEMBERED_SERVER_KEY = 'iptvnator-server:instance';

export interface ServerStorageStart {
    readonly instance: ServerInstanceInfo;
    /** No answer at start; the instance comes from this browser's memory. */
    readonly startedOffline: boolean;
}

interface RememberedServer {
    readonly baseUrl: string;
    readonly instance: ServerInstanceInfo;
}

/**
 * Decides whether the app starts in server mode. A browser that has used
 * this server before stays in server mode while it does not answer (shown
 * as offline), so it never falls back to an empty browser library and
 * collects playlists the server will not see. An answer without server
 * storage forgets the server.
 */
export function resolveServerStorageStart(
    probe: ServerInstanceProbe,
    baseUrl: string,
    storage: Pick<
        Storage,
        'getItem' | 'setItem' | 'removeItem'
    > | null = safeLocalStorage()
): ServerStorageStart | null {
    switch (probe.kind) {
        case 'server': {
            const remembered = read(storage);
            // Another server, or another database behind this one: the
            // stored token was not given for it.
            if (
                !remembered ||
                backendIdentity(remembered.baseUrl) !==
                    backendIdentity(baseUrl) ||
                remembered.instance.instanceId !== probe.instance.instanceId
            ) {
                clearServerAccessToken();
            }
            write(storage, { baseUrl, instance: probe.instance });
            return { instance: probe.instance, startedOffline: false };
        }
        case 'none':
            remove(storage);
            // The token belonged to that server; another must not see it.
            clearServerAccessToken();
            return null;
        case 'unreachable': {
            const remembered = read(storage);
            return remembered &&
                backendIdentity(remembered.baseUrl) === backendIdentity(baseUrl)
                ? { instance: remembered.instance, startedOffline: true }
                : null;
        }
        default:
            return null;
    }
}

/**
 * Origin and path of a backend URL, without trailing slashes: `/api` and
 * `/api/` (or the same URL written absolute) name one server, as they do
 * for the probe and the API client.
 */
function backendIdentity(url: string): string {
    try {
        const resolved = new URL(url.trim(), globalThis.location?.href);
        return `${resolved.origin}${resolved.pathname.replace(/\/+$/, '')}`;
    } catch {
        return url.trim().replace(/\/+$/, '');
    }
}

function read(
    storage: Pick<Storage, 'getItem'> | null
): RememberedServer | null {
    try {
        const raw = storage?.getItem(REMEMBERED_SERVER_KEY);
        const parsed = raw ? (JSON.parse(raw) as RememberedServer) : null;
        return parsed &&
            typeof parsed.baseUrl === 'string' &&
            parsed.instance?.storage === 'server' &&
            typeof parsed.instance.instanceId === 'string'
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/**
 * Remembers the server a token was accepted for; false when storage
 * refused it (the next start would take the token for another server's).
 */
export function rememberServer(
    baseUrl: string,
    instance: ServerInstanceInfo,
    storage: Pick<Storage, 'setItem'> | null = safeLocalStorage()
): boolean {
    return write(storage, { baseUrl, instance });
}

function write(
    storage: Pick<Storage, 'setItem'> | null,
    value: RememberedServer
): boolean {
    try {
        storage?.setItem(REMEMBERED_SERVER_KEY, JSON.stringify(value));
        return !!storage;
    } catch {
        // Without storage an offline start falls back to browser mode.
        return false;
    }
}

function remove(storage: Pick<Storage, 'removeItem'> | null): void {
    try {
        storage?.removeItem(REMEMBERED_SERVER_KEY);
    } catch {
        // Nothing stored.
    }
}

function safeLocalStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

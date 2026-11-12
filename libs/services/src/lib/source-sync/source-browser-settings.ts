import type {
    SavedSourceServerConnection,
    SourceServerConnection,
} from '@iptvnator/shared/interfaces';
import {
    CONNECTION_KEY,
    DISABLED_KEY,
    assertSourceInstance,
    parseSourceConnection,
    tokenKey,
    markSourceConnectionReadFailed,
} from './source-connection';

function readDisconnectedSelection(): SourceServerConnection | null {
    if (localStorage.getItem(CONNECTION_KEY)) return null;
    const raw = localStorage.getItem(DISABLED_KEY);
    if (!raw || raw === '1') return null;
    try {
        return parseSourceConnection(raw);
    } catch {
        return null;
    }
}

export function readSavedBrowserSourceConnection(): SavedSourceServerConnection | null {
    try {
        const saved = readDisconnectedSelection();
        if (!saved) return null;
        let hasToken = false;
        try {
            hasToken = Boolean(sessionStorage.getItem(tokenKey(saved)));
        } catch {
            /* The address is still available when tab storage is denied. */
        }
        return { ...saved, hasToken };
    } catch {
        return null;
    }
}

export function forgetSavedBrowserSourceConnection(): void {
    const saved = readDisconnectedSelection();
    if (!saved) return;
    removeBrowserSourceToken(saved);
    localStorage.setItem(DISABLED_KEY, '1');
}

function removeBrowserSourceToken(connection: SourceServerConnection): void {
    try {
        sessionStorage.removeItem(tokenKey(connection));
    } catch {
        /* Address changes can still succeed when tab storage is denied. */
    }
}

function savedBrowserSourceToken(connection: SourceServerConnection): string {
    const saved = readDisconnectedSelection();
    if (
        saved?.apiUrl !== connection.apiUrl ||
        saved.instanceId !== connection.instanceId
    )
        throw new Error('SOURCE_SYNC.SAVED_INSTANCE_CHANGED');
    return sessionStorage.getItem(tokenKey(saved)) ?? '';
}

export function saveBrowserSourceConnection(
    connection: SourceServerConnection,
    token: string,
    expected?: SourceServerConnection
): void {
    if (expected) {
        const saved = localStorage.getItem(CONNECTION_KEY);
        const current = saved ? parseSourceConnection(saved) : null;
        if (
            current?.apiUrl !== expected.apiUrl ||
            current?.instanceId !== expected.instanceId
        )
            return;
    }
    const previous = readDisconnectedSelection();
    sessionStorage.setItem(tokenKey(connection), token);
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    localStorage.removeItem(DISABLED_KEY);
    if (previous && tokenKey(previous) !== tokenKey(connection))
        removeBrowserSourceToken(previous);
}

export function disconnectBrowserSourceConnection(
    disableDiscovery = true,
    expected?: SourceServerConnection
): boolean {
    try {
        const raw = localStorage.getItem(CONNECTION_KEY);
        let current: SourceServerConnection | null = null;
        if (raw) {
            try {
                current = parseSourceConnection(raw);
            } catch (error) {
                if (!disableDiscovery) throw error;
            }
        }
        if (
            expected &&
            current &&
            (current.apiUrl !== expected.apiUrl ||
                current.instanceId !== expected.instanceId)
        )
            return true;
        if (disableDiscovery && (raw || !localStorage.getItem(DISABLED_KEY))) {
            const saved = current && !current.instanceId.startsWith('pending:');
            localStorage.setItem(
                DISABLED_KEY,
                saved ? JSON.stringify(current) : '1'
            );
        }
        localStorage.removeItem(CONNECTION_KEY);
        const discarded = current ?? expected;
        if (!disableDiscovery && discarded) removeBrowserSourceToken(discarded);
        return true;
    } catch {
        markSourceConnectionReadFailed();
        return false;
    }
}

export async function connectBrowserSourceServer(
    apiUrl: string,
    enteredToken: string,
    currentInstanceId: string | undefined,
    reuse: SourceServerConnection | null
): Promise<void> {
    const response = await fetch(`${apiUrl}/v1/instance`, {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
        throw new Error(
            [401, 403].includes(response.status)
                ? 'SOURCE_SYNC.LOCKED'
                : 'SOURCE_SYNC.CONNECTION_FAILED'
        );
    const instance: unknown = await response.json().catch(() => {
        throw new Error('SOURCE_SYNC.INCOMPATIBLE');
    });
    assertSourceInstance(instance);
    if (currentInstanceId && instance.instanceId !== currentInstanceId)
        throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
    if (
        reuse &&
        (apiUrl !== reuse.apiUrl || instance.instanceId !== reuse.instanceId)
    )
        throw new Error('SOURCE_SYNC.SAVED_INSTANCE_CHANGED');
    const token = reuse ? savedBrowserSourceToken(reuse) : enteredToken;
    const check = await fetch(`${apiUrl}/v1/sources`, {
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(reuse ? { 'X-IPTVnator-Instance-Id': reuse.instanceId } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
    });
    if (!check.ok)
        throw new Error(
            [401, 403].includes(check.status)
                ? 'SOURCE_SYNC.LOCKED'
                : 'SOURCE_SYNC.CONNECTION_FAILED'
        );
    if (reuse && savedBrowserSourceToken(reuse) !== token)
        throw new Error('SOURCE_SYNC.SAVED_INSTANCE_CHANGED');
    saveBrowserSourceConnection(
        { apiUrl, instanceId: instance.instanceId },
        token
    );
}

import type { Request, Response } from 'express';
import { portalIdentityKey } from './account-identity.js';
import { getScenario } from './scenarios.js';

/**
 * How long a stream counts as connected after its last request. Live HLS
 * reloads its playlist from the redirect target, so the mock only sees the
 * first request of a stream: the window stands in for the open connection.
 */
export const CONNECTION_WINDOW_MS = 20_000;

/** Account → stream id → last request time. */
const streamsByAccount = new Map<string, Map<string, number>>();

export function resetConnectionLimits(
    username?: string,
    password?: string
): void {
    if (username !== undefined && password !== undefined) {
        streamsByAccount.delete(portalIdentityKey(username, password));
    } else {
        streamsByAccount.clear();
    }
}

function liveStreams(account: string, now: number): Map<string, number> {
    const streams = streamsByAccount.get(account) ?? new Map<string, number>();
    for (const [id, seen] of streams) {
        if (now - seen > CONNECTION_WINDOW_MS) streams.delete(id);
    }
    streamsByAccount.set(account, streams);
    return streams;
}

/** `active_cons` for `user_info`: streams connected right now. */
export function activeConnections(
    username: string,
    password: string,
    now = Date.now()
): number {
    return liveStreams(portalIdentityKey(username, password), now).size;
}

/**
 * Scenarios with `connectionLimit` refuse a stream once that many other
 * streams of the account are connected, like a panel enforcing
 * `max_connections` (multiview spec 12, R-E). Returns true when it answered.
 */
export function refuseOverConnectionLimit(
    request: Request,
    response: Response,
    now = Date.now()
): boolean {
    const username = String(request.params['username'] ?? '');
    const password = String(request.params['password'] ?? '');
    const limit = getScenario(username, password).connectionLimit;
    if (limit === undefined) return false;
    const streams = liveStreams(portalIdentityKey(username, password), now);
    const streamId = String(request.params['streamId'] ?? '');
    if (!streams.has(streamId) && streams.size >= limit) {
        response
            .status(403)
            .type('text/plain')
            .send('Maximum number of connections reached');
        return true;
    }
    streams.set(streamId, now);
    return false;
}

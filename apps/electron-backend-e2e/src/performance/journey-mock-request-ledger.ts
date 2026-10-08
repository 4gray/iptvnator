import {
    createServer,
    request as httpRequest,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Counts the HTTP requests the app sends to the Xtream mock.
 *
 * The journey profile is seeded with the origin of this loopback proxy
 * instead of the mock's own origin, so every request for the portal and the
 * M3U source passes through it, whether the main process sends it (Xtream
 * API, M3U) or the renderer does (artwork served by the mock). The mock's
 * `/__control/state` ledger only exists in performance-control mode, which
 * disables `/playlist.m3u` and tracks only the 100k scenario, and a
 * Playwright request listener sees renderer traffic only.
 *
 * The ledger keeps the method, the path and, for `player_api.php`, the
 * `action` parameter. Query strings carry the portal credentials and are
 * never stored.
 */
export interface JourneyMockRequest {
    /**
     * Arrival as a sub-millisecond epoch (`performance.timeOrigin +
     * performance.now()`), the same form as the renderer's click stamp. With
     * `Date.now()` a request later in the click's millisecond would compare
     * as earlier than the fractional click and be counted before it.
     */
    readonly epochMs: number;
    readonly method: string;
    readonly route: string;
    readonly sequence: number;
}

export interface JourneyMockRequestLedger {
    close(): Promise<void>;
    /** Requests whose response has not finished yet. */
    inFlight(): number;
    /** Sequence number of the next request; pass it to `since`. */
    mark(): number;
    readonly origin: string;
    since(mark: number): readonly JourneyMockRequest[];
}

/** `GET /player_api.php?action=get_live_streams&...` → `/player_api.php?action=get_live_streams`. */
export function describeJourneyMockRoute(rawUrl: string | undefined): string {
    const url = new URL(rawUrl ?? '/', 'http://journey.invalid');
    const action = url.searchParams.get('action');
    if (url.pathname.endsWith('/player_api.php')) {
        return action === null
            ? url.pathname
            : `${url.pathname}?action=${encodeURIComponent(action)}`;
    }
    // Stream paths embed the credentials: /live/<user>/<password>/<id>.ts.
    const segments = url.pathname.split('/');
    if (
        ['live', 'movie', 'series', 'timeshift'].includes(segments[1] ?? '') &&
        segments.length > 3
    ) {
        segments[2] = ':username';
        segments[3] = ':password';
    }
    return segments.join('/');
}

/** Route → count, sorted by route, for evidence. */
export function countJourneyMockRoutes(
    requests: readonly JourneyMockRequest[]
): Record<string, number> {
    const counts = new Map<string, number>();
    for (const entry of requests) {
        counts.set(entry.route, (counts.get(entry.route) ?? 0) + 1);
    }
    return Object.fromEntries(
        [...counts.entries()].sort(([left], [right]) =>
            left.localeCompare(right)
        )
    );
}

export async function startJourneyMockRequestLedger(
    targetOrigin: string
): Promise<JourneyMockRequestLedger> {
    const target = new URL(targetOrigin);
    if (target.protocol !== 'http:') {
        throw new Error('journey-mock-ledger-http-only');
    }
    const requests: JourneyMockRequest[] = [];
    let active = 0;
    const forward = (
        incoming: IncomingMessage,
        outgoing: ServerResponse
    ): void => {
        active += 1;
        // `close` fires once per response, finished or aborted.
        outgoing.once('close', () => {
            active -= 1;
        });
        requests.push({
            epochMs: performance.timeOrigin + performance.now(),
            method: incoming.method ?? 'GET',
            route: describeJourneyMockRoute(incoming.url),
            sequence: requests.length,
        });
        const upstream = httpRequest(
            {
                headers: { ...incoming.headers, host: target.host },
                hostname: target.hostname,
                method: incoming.method,
                path: incoming.url,
                port: target.port,
            },
            (response) => {
                outgoing.writeHead(
                    response.statusCode ?? 502,
                    response.headers
                );
                response.pipe(outgoing);
            }
        );
        upstream.on('error', () => {
            if (!outgoing.headersSent) {
                outgoing.writeHead(502);
            }
            outgoing.end();
        });
        incoming.pipe(upstream);
    };
    const server: Server = createServer(forward);
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    return {
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
        inFlight: () => active,
        mark: () => requests.length,
        origin: `http://127.0.0.1:${port}`,
        since: (mark) => requests.slice(mark),
    };
}

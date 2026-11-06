import type { Server } from 'node:http';

/** How long open requests may finish before their connections are cut. */
export const SHUTDOWN_GRACE_MS = 5_000;

/**
 * Stops accepting connections, closes idle keep-alive sockets at once and
 * cuts the remaining ones after `graceMs`: a provider download that keeps
 * sending bytes must not hold the shutdown open until Docker kills it.
 */
export function closeGracefully(
    server: Server,
    graceMs = SHUTDOWN_GRACE_MS
): Promise<void> {
    return new Promise((resolve) => {
        const deadline = setTimeout(
            () => server.closeAllConnections(),
            graceMs
        );
        deadline.unref();
        server.close(() => {
            clearTimeout(deadline);
            resolve();
        });
        server.closeIdleConnections();
    });
}

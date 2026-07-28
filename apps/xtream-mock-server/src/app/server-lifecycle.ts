import type { Server } from 'node:http';

const SHUTDOWN_DEADLINE_MS = 1_000;

export interface XtreamMockShutdownApplication {
    shutdown(): unknown;
}

export function createXtreamMockServerShutdown(
    server: Server,
    application: XtreamMockShutdownApplication
): () => Promise<void> {
    let shutdownPromise: Promise<void> | undefined;
    return () => {
        shutdownPromise ??= beginShutdown(server, application);
        return shutdownPromise;
    };
}

function beginShutdown(
    server: Server,
    application: XtreamMockShutdownApplication
): Promise<void> {
    try {
        application.shutdown();
    } catch {
        // HTTP shutdown must remain bounded even if an application hook fails.
    }
    return closeHttpServer(server);
}

function closeHttpServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            resolve();
        };
        const deadline = setTimeout(() => {
            server.closeAllConnections();
            finish();
        }, SHUTDOWN_DEADLINE_MS);
        deadline.unref();

        try {
            server.close(() => finish());
            server.closeIdleConnections();
            server.closeAllConnections();
        } catch {
            finish();
        }
    });
}

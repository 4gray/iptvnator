import { createServer } from 'node:http';
import { join } from 'node:path';
import {
    xtreamMockServer,
    type LaunchedElectronApp,
} from './electron-test-fixtures';

/** Observe real main-process API requests without recording credentials. */
export async function recordCatalogRequests() {
    const actions: string[] = [];
    const userAgents = new Map<string, string>();
    const responses = new Map<string, unknown>();
    let heldAction: string | null = null;
    let failedAction: string | null = null;
    let heldResponse: Promise<void> = Promise.resolve();
    let releaseResponse: (() => void) | undefined;
    const server = createServer(async (request, response) => {
        try {
            const incoming = new URL(request.url ?? '/', xtreamMockServer);
            // Only path/query may come from the client, never the destination.
            const url = new URL(xtreamMockServer);
            url.pathname = incoming.pathname;
            url.search = incoming.search;
            const action = url.searchParams.get('action');
            if (action) {
                actions.push(action);
                userAgents.set(action, request.headers['user-agent'] ?? '');
            }
            if (action === failedAction) {
                response
                    .writeHead(503, { 'Content-Type': 'application/json' })
                    .end(
                        JSON.stringify({ error: 'simulated catalog failure' })
                    );
                return;
            }
            if (action === heldAction) await heldResponse;
            if (action && responses.has(action)) {
                response.writeHead(200, {
                    'Content-Type': 'application/json',
                });
                response.end(JSON.stringify(responses.get(action)));
                return;
            }
            const upstream = await fetch(url);
            response.writeHead(upstream.status, {
                'Content-Type': 'application/json',
            });
            response.end(await upstream.text());
        } catch {
            response.writeHead(502).end();
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('No local mock port');
    return {
        actions,
        userAgents,
        respond(action: string, body: unknown) {
            responses.set(action, body);
        },
        fail(action: string) {
            failedAction = action;
            return () => {
                failedAction = null;
            };
        },
        hold(action: string) {
            heldAction = action;
            heldResponse = new Promise<void>((resolve) => {
                releaseResponse = resolve;
            });
            return () => {
                heldAction = null;
                releaseResponse?.();
            };
        },
        url: `http://127.0.0.1:${address.port}`,
        close: () => {
            releaseResponse?.();
            return new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        },
    };
}

export const catalogActions = (actions: string[]) =>
    actions.filter((action) =>
        /^(get_(live|vod|series)_categories|get_live_streams|get_vod_streams|get_series)$/.test(
            action
        )
    );

/** Inspect actual persisted history, independently of the UI's intentional 100-row cap. */
export async function persistedHistoryCount(
    app: LaunchedElectronApp,
    dataDir: string,
    playlistId: string
): Promise<number> {
    return app.electronApp.evaluate(
        (_electron, { dependency, file, playlistId }) => {
            const Database = process
                .getBuiltinModule('module')
                .createRequire(dependency)(dependency);
            const db = new Database(file, { readonly: true });
            try {
                return db
                    .prepare(
                        'SELECT count(*) AS n FROM recently_viewed WHERE playlist_id = ?'
                    )
                    .get(playlistId).n;
            } finally {
                db.close();
            }
        },
        {
            dependency: join(__dirname, '../../../node_modules/better-sqlite3'),
            file: join(dataDir, 'databases/iptvnator.db'),
            playlistId,
        }
    );
}

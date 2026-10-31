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
    let heldAction: string | null = null;
    let heldResponse: Promise<void> = Promise.resolve();
    let releaseResponse: (() => void) | undefined;
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? '/', xtreamMockServer);
            const action = url.searchParams.get('action');
            if (action) {
                actions.push(action);
                userAgents.set(action, request.headers['user-agent'] ?? '');
            }
            if (action === heldAction) await heldResponse;
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

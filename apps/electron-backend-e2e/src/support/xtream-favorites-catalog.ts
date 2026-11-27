import { createServer } from 'node:http';
import type { Page } from '@playwright/test';
import type { ElectronBridgeXtreamFavorite } from '@iptvnator/shared/interfaces';
import {
    expect,
    openSources,
    refreshSource,
    sourceRowByTitle,
    waitForXtreamWorkspaceReady,
    xtreamMockServer,
} from '../electron-test-fixtures';

export type FavoritesCatalogMode =
    | { kind: 'normal' | 'empty' | 'failure' | 'offline' }
    | { kind: 'omit' | 'duplicate'; xtreamId: number };

export interface FavoritesCatalogProxy {
    origin: string;
    setMode(mode: FavoritesCatalogMode): void;
    responseCount(action: string): number;
    close(): Promise<void>;
}

/** Main-process HTTP cannot be intercepted by Playwright's page.route(). */
export async function createFavoritesCatalogProxy(): Promise<FavoritesCatalogProxy> {
    let mode: FavoritesCatalogMode = { kind: 'normal' };
    const responses = new Map<string, number>();
    const pending = new Set<AbortController>();
    const server = createServer((request, response) => {
        const incoming = new URL(request.url ?? '/', xtreamMockServer);
        // Only path/query may vary: an absolute request target must never select
        // a different upstream host for this local test proxy.
        const url = new URL(xtreamMockServer);
        url.pathname = incoming.pathname;
        url.search = incoming.search;
        const action = url.searchParams.get('action') ?? 'get_account_info';
        const requestMode = mode;
        response.once('finish', () => {
            responses.set(action, (responses.get(action) ?? 0) + 1);
        });
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');

        if (
            requestMode.kind === 'offline' ||
            (action === 'get_vod_streams' && requestMode.kind === 'failure')
        ) {
            response.writeHead(503).end('{"error":"fixture-unavailable"}');
            return;
        }
        if (action === 'get_vod_streams' && requestMode.kind === 'empty') {
            response.end('[]');
            return;
        }

        const controller = new AbortController();
        pending.add(controller);
        const timeout = setTimeout(() => controller.abort(), 10_000);
        void (async () => {
            try {
                const upstream = await fetch(url, {
                    redirect: 'manual',
                    signal: controller.signal,
                });
                let body = await upstream.text();
                if (
                    action === 'get_vod_streams' &&
                    requestMode.kind === 'omit'
                ) {
                    const movies = JSON.parse(body) as {
                        stream_id: number | string;
                    }[];
                    body = JSON.stringify(
                        movies.filter(
                            (movie) =>
                                Number(movie.stream_id) !== requestMode.xtreamId
                        )
                    );
                }
                if (requestMode.kind === 'duplicate') {
                    if (action === 'get_vod_categories') {
                        body = JSON.stringify([
                            ...JSON.parse(body),
                            {
                                category_id: '987654',
                                category_name: 'Compatible duplicate',
                                parent_id: 0,
                            },
                        ]);
                    } else if (action === 'get_vod_streams') {
                        const movies = JSON.parse(body) as Record<
                            string,
                            unknown
                        >[];
                        const original = movies.find(
                            (movie) =>
                                Number(movie['stream_id']) ===
                                requestMode.xtreamId
                        );
                        if (original)
                            movies.push({
                                ...original,
                                category_id: '987654',
                                name: 'Compatible duplicate movie',
                            });
                        body = JSON.stringify(movies);
                    } else if (
                        action === 'get_vod_info' &&
                        Number(url.searchParams.get('vod_id')) ===
                            requestMode.xtreamId
                    ) {
                        const detail = JSON.parse(body);
                        Object.assign(detail.info, {
                            tmdb_id: 100,
                            tmdb: 100,
                            releasedate: '1995-01-01',
                        });
                        body = JSON.stringify(detail);
                    }
                }
                response.writeHead(upstream.status).end(body);
            } catch {
                if (!response.destroyed) {
                    response
                        .writeHead(502)
                        .end('{"error":"fixture-upstream-failed"}');
                }
            } finally {
                clearTimeout(timeout);
                pending.delete(controller);
            }
        })();
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Favorites fixture did not bind a TCP port');
    }
    return {
        origin: `http://127.0.0.1:${address.port}`,
        setMode: (next) => {
            mode = next;
        },
        responseCount: (action) => responses.get(action) ?? 0,
        close: () =>
            new Promise<void>((resolve, reject) => {
                pending.forEach((controller) => controller.abort());
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}

export function readSavedFavorites(page: Page, playlistId: string) {
    return page.evaluate(
        (id) => window.electron.dbGetFavorites(id),
        playlistId
    );
}

/** Exclude the replaceable catalog link while retaining every user-owned field. */
export function savedFavoriteIdentity(rows: ElectronBridgeXtreamFavorite[]) {
    return rows.map((row) => ({
        favoriteId: row.favorite_id,
        xtreamId: row.xtream_id,
        title: row.title,
        addedAt: row.added_at,
        position: row.position,
    }));
}

export async function refreshFavoriteCatalog(
    page: Page,
    proxy: FavoritesCatalogProxy,
    playlistId: string,
    title: string,
    entry: 'sources' | 'header',
    expectedImportState: 'completed' | 'failed' = 'completed'
): Promise<void> {
    await openSources(page);
    if (entry === 'header') {
        await sourceRowByTitle(page, title).first().click();
        await waitForXtreamWorkspaceReady(page);
    }
    const requestsBefore = proxy.responseCount('get_vod_streams');
    if (entry === 'sources') {
        await refreshSource(page, title, { confirm: true });
    } else {
        await page.getByTestId('playlist-switcher-trigger').click();
        await page
            .locator(
                'app-playlist-switcher-panel [role="option"][aria-current="true"] .source-row__more'
            )
            .click();
        await page
            .getByRole('menuitem', { name: 'Refresh source', exact: true })
            .click();
        const dialog = page.locator('mat-dialog-container');
        await dialog
            .getByRole('button', { name: 'Refresh source', exact: true })
            .click();
        await expect(dialog).toHaveCount(0);
    }
    // A completed status from the previous generation cannot satisfy this refresh.
    await expect
        .poll(() => proxy.responseCount('get_vod_streams'), {
            timeout: 30_000,
        })
        .toBeGreaterThan(requestsBefore);
    await expect
        .poll(
            () =>
                page.evaluate(
                    (id) =>
                        window.electron.dbGetAppState(
                            `xtream-import-status:${id}:movie`
                        ),
                    playlistId
                ),
            { timeout: 30_000 }
        )
        .toBe(expectedImportState);
    await expect(page.locator('.workspace-loading-overlay')).toHaveCount(0, {
        timeout: 30_000,
    });
}

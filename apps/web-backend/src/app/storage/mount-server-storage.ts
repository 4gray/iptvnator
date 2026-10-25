import type { Express, RequestHandler } from 'express';
import { createAccessGuard } from './access-guard';
import { createInstanceRouter } from './instance-router';
import { createPlaylistsRouter } from './playlists-router';
import type { ServerStorage } from './server-storage';
import { storageErrorHandler } from './storage-route-errors';
import { createUserStateRouter } from './user-state-router';

export const DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ServerStorageMountOptions {
    readonly corsMiddleware: RequestHandler;
    readonly storage: ServerStorage | null;
    readonly accessToken: string | null;
    readonly maxDocumentBytes: number;
}

/**
 * Mounts `/v1` and the optional token guard. Call it before the provider
 * proxy routes are registered so the guard also covers them. With a token
 * the CORS headers apply to every route, so a cross-origin 401 stays
 * readable for the PWA in development.
 */
export function mountServerStorage(
    app: Express,
    options: ServerStorageMountOptions
): void {
    app.use('/v1', options.corsMiddleware);
    if (options.accessToken) {
        app.use(options.corsMiddleware);
        app.use(createAccessGuard(options.accessToken));
    }

    app.use(
        '/v1',
        createInstanceRouter({
            storage: options.storage,
            accessTokenRequired: !!options.accessToken,
        })
    );
    if (options.storage) {
        app.use(
            '/v1',
            createPlaylistsRouter(options.storage, options.maxDocumentBytes)
        );
        app.use('/v1', createUserStateRouter(options.storage));
    }
    app.use('/v1', storageErrorHandler());
}

import type { Express, RequestHandler } from 'express';
import { DevicePairingStore } from './device-pairing-store';
import { createDevicePairingRouter } from './device-pairing-router';
import { createAccessGuard } from './access-guard';
import { createInstanceRouter } from './instance-router';
import { createPlaylistsRouter } from './playlists-router';
import type { ServerStorage } from './server-storage';
import { storageErrorHandler } from './storage-route-errors';
import { createUserStateRouter } from './user-state-router';
import { createSourcesRouter } from './sources-router';
import { createHistoryRouter } from './history-router';
import { createFavoriteRouter } from './favorites-router';
import { createActivityRouter } from './activity-router';

export const DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ServerStorageMountOptions {
    readonly corsMiddleware: RequestHandler;
    readonly storage: ServerStorage | null;
    readonly accessToken: string | null;
    readonly maxDocumentBytes: number;
    readonly devicePairingEnabled?: boolean;
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
    const pairing =
        options.devicePairingEnabled && options.storage && options.accessToken
            ? new DevicePairingStore(options.storage.database.sqlite)
            : null;
    if (pairing && options.accessToken && options.storage) {
        app.use(
            '/v1',
            createDevicePairingRouter(
                pairing,
                options.accessToken,
                options.storage.database.instanceId
            )
        );
    }
    if (options.accessToken) {
        app.use(options.corsMiddleware);
        app.use(
            createAccessGuard(
                options.accessToken,
                pairing ? (token) => pairing.accepts(token) : undefined
            )
        );
    }

    app.use(
        '/v1',
        createInstanceRouter({
            storage: options.storage,
            accessTokenRequired: !!options.accessToken,
        })
    );
    if (options.storage) {
        app.use('/v1', createActivityRouter(options.storage));
        app.use('/v1', createFavoriteRouter(options.storage));
        app.use('/v1', createHistoryRouter(options.storage));
        app.use(
            '/v1',
            createSourcesRouter(options.storage, options.maxDocumentBytes)
        );
        app.use(
            '/v1',
            createPlaylistsRouter(options.storage, options.maxDocumentBytes)
        );
        app.use('/v1', createUserStateRouter(options.storage));
    }
    app.use('/v1', storageErrorHandler());
}

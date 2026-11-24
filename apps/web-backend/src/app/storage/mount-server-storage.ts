import type { IncomingMessage } from 'node:http';
import type { Express, RequestHandler } from 'express';
import {
    isHostedWorkerRequest,
    type HostedIngressState,
} from '../hosted-ingress';
import { DevicePairingStore } from './device-pairing-store';
import { createDevicePairingRouter } from './device-pairing-router';
import { createAccessGuard } from './access-guard';
import { createInstanceRouter } from './instance-router';
import { createPlaylistsRouter } from './playlists-router';
import type { ServerStorage } from './server-storage';
import { StorageRequestError, storageErrorHandler } from './storage-route-errors';
import { createUserStateRouter } from './user-state-router';
import { createSourcesRouter } from './sources-router';
import { createHistoryRouter } from './history-router';
import { createFavoriteRouter } from './favorites-router';
import { createActivityRouter } from './activity-router';
import {
    cloudflareDeviceError,
    cloudflareDeviceState,
} from './cloudflare-device-access';
import { createProfilesRouter } from './profiles-router';
import { createTmdbTransferRouter } from '../tmdb-transfer/tmdb-transfer-router';

export const DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ServerStorageMountOptions {
    readonly corsMiddleware: RequestHandler;
    readonly storage: ServerStorage | null;
    readonly accessToken: string | null;
    readonly maxDocumentBytes: number;
    readonly devicePairingEnabled?: boolean;
    readonly hostedIngress?: HostedIngressState;
    readonly cloudflareAccess?: import('../cloudflare-access').CloudflareAccessCheck;
    readonly hostedMode?: 'lan' | 'https' | 'proxy' | 'cloudflare';
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
    const cloudflare =
        options.hostedMode === 'cloudflare'
            ? options.cloudflareAccess
            : undefined;
    const enrolledRequests = new WeakSet<IncomingMessage>();
    if (pairing && options.accessToken && options.storage) {
        app.use(
            '/v1',
            createDevicePairingRouter(
                pairing,
                options.accessToken,
                options.storage.database.instanceId,
                options.hostedIngress,
                !!options.hostedMode,
                cloudflare
            )
        );
    }
    if (cloudflare && pairing) {
        app.use(async (req, res, next) => {
            if (
                isHostedWorkerRequest(req) ||
                req.method === 'OPTIONS' ||
                req.path === '/v1/instance'
            ) {
                next();
                return;
            }
            if (!(await cloudflare(req))) {
                res.sendStatus(403);
                return;
            }
            const state = cloudflareDeviceState(req, pairing);
            if (state !== 'active') {
                cloudflareDeviceError(res, state);
                return;
            }
            enrolledRequests.add(req);
            next();
        });
    }
    if (options.accessToken) {
        app.use(options.corsMiddleware);
        app.use(
            createAccessGuard(
                options.accessToken,
                pairing ? (token) => pairing.accepts(token) : undefined,
                cloudflare && pairing
                    ? async (req) => enrolledRequests.has(req)
                    : options.cloudflareAccess,
                options.hostedMode
            )
        );
    }

    app.use(
        '/v1',
        createInstanceRouter({
            storage: options.storage,
            accessTokenRequired: !!options.accessToken,
            cloudflareAccess: options.cloudflareAccess,
            cloudflareDeviceRegistration: !!cloudflare && !!pairing,
            browserPairing:
                !!pairing &&
                (options.hostedMode === 'lan' || options.hostedMode === 'https'),
            workerOnlyStatus: !!options.hostedMode,
        })
    );
    if (options.storage) {
        if (options.hostedMode) {
            const instance = options.storage.database.instanceId;
            app.use('/v1', (req, _res, next) => {
                const expected = req.get('x-iptvnator-instance-id');
                if (expected && expected !== instance)
                    throw new StorageRequestError(
                        409,
                        'instance_changed',
                        'The server identity changed. Reconnect before editing the library.'
                    );
                next();
            });
        }
        app.use(
            '/v1',
            createTmdbTransferRouter(options.storage.database.instanceId)
        );
        app.use('/v1', createProfilesRouter(options.storage));
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

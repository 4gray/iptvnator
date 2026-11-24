import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
} from '@iptvnator/shared/host-health';
import {
    HOSTED_SERVER_HTTPS_PORT,
    type HostedServerMode,
    type HostedServerWorkerMessage,
    type HostedWorkerRequest,
} from '@iptvnator/shared/interfaces';
import { createHostedWebApp } from './app/hosted-web-app';
import { listenHosted } from './app/hosted-listener';
import { HostedHttpsListener } from './app/hosted-https-listener';
import { readHostedTls } from './app/hosted-tls';
import { closeGracefully } from './app/graceful-shutdown';
import { createCloudflareAccessCheck } from './app/cloudflare-access';
import { hostedIngressOrigin } from './app/hosted-ingress';
import { createHostedWorkerTransport } from './app/hosted-worker-transport';
import { createWebBackendApp } from './app/web-backend-app';
import {
    readServerStorageConfig,
    serverStorageConfigProblem,
} from './app/storage/storage-config';
import {
    openServerStorage,
    type ServerStorage,
} from './app/storage/server-storage';
import { describeStorageError } from './app/storage/storage-route-errors';

type HostPort = {
    postMessage(message: HostedServerWorkerMessage): void;
    on(event: 'message', listener: (event: { data: unknown }) => void): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: HostPort })
    .parentPort;
const hostedAssets = parentPort && process.env.IPTVNATOR_HOSTED_ASSETS;

async function start(): Promise<void> {
    const attemptTimeout = applyDefaultAutoSelectFamilyAttemptTimeout();
    if (attemptTimeout !== null) {
        console.log(
            `[web-backend] connection attempt timeout set to ${attemptTimeout} ms for IPv6->IPv4 fallback; pass ${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG} via NODE_OPTIONS to override`
        );
    }

    const config = readServerStorageConfig();
    const problem = serverStorageConfigProblem(config);
    if (problem) {
        console.error(`[web-backend] ${problem}`);
        process.exit(1);
    }
    let storage: ServerStorage | null = null;
    if (config.enabled) {
        try {
            storage = await openServerStorage();
            console.log(
                `[web-backend] server storage at ${storage.database.path}`
            );
        } catch (error) {
            console.error(
                `[web-backend] server storage could not open: ${describeStorageError(error)}. Check that IPTVNATOR_DATA_DIR is a writable volume.`
            );
            process.exit(1);
        }
    }

    const port = Number(process.env['PORT'] ?? 3000);
    const serialized = hostedAssets && process.env.IPTVNATOR_HOSTED_MODE;
    const mode = serialized
        ? (JSON.parse(serialized) as HostedServerMode)
        : undefined;
    const hostedIngress = {
        origin: mode && 'origin' in mode ? mode.origin : '',
    };
    const access =
        hostedAssets && (!mode || mode.mode === 'cloudflare')
            ? createCloudflareAccessCheck()
            : undefined;
    const app = createWebBackendApp({
        storage,
        accessToken: config.accessToken,
        devicePairingEnabled: !!hostedAssets,
        hostedIngress,
        cloudflareAccess: access,
        hostedMode: mode?.mode,
        maxDocumentBytes: config.maxDocumentBytes,
        // Each hosted listener enforces an exact Host/Origin pair before CORS.
        ...(hostedAssets ? { clientOrigins: ['*'] } : {}),
    });
    if (hostedAssets) {
        if (!storage || !config.accessToken) {
            parentPort!.postMessage({ error: 'startup' });
            storage?.database.close();
            process.exit(1);
        }
        const listeners: ReturnType<typeof app.listen>[] = [];
        try {
            const hostedApp = createHostedWebApp(app, hostedAssets);
            if (mode?.mode === 'cloudflare') {
                if (!access)
                    throw new Error('Missing Cloudflare Access configuration');
                const protectedApp = createHostedWebApp(
                    app,
                    hostedAssets,
                    async (req, res, next) => {
                        if (
                            hostedIngressOrigin(req) !== mode.origin ||
                            !(await access(req))
                        ) {
                            res.sendStatus(403);
                            return;
                        }
                        next();
                    }
                );
                const tls = mode.certificatePath ? readHostedTls(mode) : undefined;
                listeners.push(
                    await listenHosted(
                        protectedApp,
                        '127.0.0.1',
                        HOSTED_SERVER_HTTPS_PORT,
                        new URL(mode.origin),
                        tls
                    )
                );
            } else if (mode?.mode === 'https' || mode?.mode === 'proxy') {
                const origin = new URL(mode.origin);
                const tls =
                    mode.mode === 'https'
                        ? readHostedTls({ ...mode, mode: 'https' })
                        : undefined;
                const listenPort = tls
                    ? Number(origin.port || 443)
                    : HOSTED_SERVER_HTTPS_PORT;
                listeners.push(
                    await listenHosted(
                        hostedApp,
                        mode.address || '127.0.0.1',
                        listenPort,
                        origin,
                        tls
                    )
                );
            } else if (mode?.mode === 'lan') {
                listeners.push(
                    await listenHosted(
                        hostedApp,
                        mode.address || '127.0.0.1',
                        port
                    )
                );
            }
            const remote = new HostedHttpsListener(hostedApp);
            if (!mode) {
                listeners.push(
                    await listenHosted(hostedApp, '127.0.0.1', port)
                );
                const lan = process.env.IPTVNATOR_HOSTED_LAN;
                if (lan)
                    listeners.push(await listenHosted(hostedApp, lan, port));
            }
            const workerRequest = createHostedWorkerTransport(app);
            let transition = Promise.resolve();
            parentPort!.on('message', ({ data }) => {
                if (
                    data &&
                    typeof data === 'object' &&
                    'workerRequest' in data &&
                    'requestId' in data &&
                    typeof data.requestId === 'string'
                ) {
                    const reply = data.requestId;
                    void workerRequest(
                        data.workerRequest as HostedWorkerRequest
                    ).then(
                        (response) =>
                            parentPort!.postMessage({ reply, response }),
                        () => parentPort!.postMessage({ reply })
                    );
                    return;
                }
                if (
                    !mode &&
                    data &&
                    typeof data === 'object' &&
                    'httpsOrigin' in data &&
                    typeof data.httpsOrigin === 'string' &&
                    'requestId' in data &&
                    typeof data.requestId === 'string'
                ) {
                    const origin = data.httpsOrigin;
                    const requestId = data.requestId;
                    transition = transition.then(async () => {
                        try {
                            hostedIngress.origin = '';
                            hostedIngress.origin =
                                await remote.configure(origin);
                            parentPort!.postMessage({
                                https: true,
                                requestId,
                                origin: hostedIngress.origin,
                            });
                        } catch {
                            parentPort!.postMessage({
                                https: true,
                                requestId,
                                origin: '',
                                failed: true,
                            });
                        }
                    });
                }
                if (data === 'stop') {
                    transition = transition.then(async () => {
                        await remote.stop();
                        await Promise.all(
                            listeners.map((listener) =>
                                closeGracefully(listener)
                            )
                        );
                        storage.database.close();
                        process.exit(0);
                    });
                }
            });
            parentPort!.postMessage({
                ready: true,
                instanceId: storage.database.instanceId,
            });
        } catch (error) {
            await Promise.all(
                listeners.map((listener) => closeGracefully(listener))
            );
            storage.database.close();
            parentPort!.postMessage({
                error:
                    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
                        ? 'port'
                        : (error as NodeJS.ErrnoException).code === 'HOSTED_TLS'
                          ? 'tls'
                          : 'startup',
            });
            process.exit(1);
        }
        return;
    }

    const server = app.listen(port, () => {
        console.log(
            `IPTVnator web backend listening on http://localhost:${port}`
        );
    });

    const shutdown = () => {
        void closeGracefully(server).then(() => {
            storage?.database.close();
            process.exit(0);
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

void start();

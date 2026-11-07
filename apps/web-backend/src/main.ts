import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
} from '@iptvnator/shared/host-health';
import type { HostedServerWorkerMessage } from '@iptvnator/shared/interfaces';
import { createHostedWebApp } from './app/hosted-web-app';
import { listenHosted } from './app/hosted-listener';
import { closeGracefully } from './app/graceful-shutdown';
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
    once(event: 'message', listener: (event: { data: unknown }) => void): void;
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
    const app = createWebBackendApp({
        storage,
        accessToken: config.accessToken,
        maxDocumentBytes: config.maxDocumentBytes,
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
            listeners.push(await listenHosted(hostedApp, '127.0.0.1', port));
            const lan = process.env.IPTVNATOR_HOSTED_LAN;
            if (lan) listeners.push(await listenHosted(hostedApp, lan, port));
            parentPort!.once('message', ({ data }) => {
                if (data === 'stop') {
                    void Promise.all(
                        listeners.map((listener) => closeGracefully(listener))
                    ).then(() => {
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

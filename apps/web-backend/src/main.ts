import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
} from '@iptvnator/shared/host-health';
import { closeGracefully } from './app/graceful-shutdown';
import { createWebBackendApp } from './app/web-backend-app';
import { readServerStorageConfig } from './app/storage/storage-config';
import {
    openServerStorage,
    type ServerStorage,
} from './app/storage/server-storage';
import { describeStorageError } from './app/storage/storage-route-errors';

async function start(): Promise<void> {
    const attemptTimeout = applyDefaultAutoSelectFamilyAttemptTimeout();
    if (attemptTimeout !== null) {
        console.log(
            `[web-backend] connection attempt timeout set to ${attemptTimeout} ms for IPv6->IPv4 fallback; pass ${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG} via NODE_OPTIONS to override`
        );
    }

    const config = readServerStorageConfig();
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

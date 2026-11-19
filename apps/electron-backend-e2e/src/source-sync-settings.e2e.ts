import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeElectronApp, launchElectronApp } from './electron-test-fixtures';
import {
    verifySourceSettingsRecovery,
    verifySourceConnectionRecheck,
    verifySourceReconnectAfterRestart,
} from './source-sync-settings';

test.describe('source sync with the hosted backend', () => {
    test.skip(
        process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
        'Run with playwright.source-sync.config.ts'
    );

    test('validates source settings and retains credentials after a native connection failure @electron @settings', async () => {
        await verifySourceSettingsRecovery();
    });

    test('renews credentials and rechecks an existing connection without restarting Electron @electron @settings', async () => {
        await verifySourceConnectionRecheck();
    });

    test('reconnects to the saved server after Electron restarts @electron @settings', async () => {
        await verifySourceReconnectAfterRestart();
    });
});

test('connects to an HTTPS source server signed by a system CA @electron @settings', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-source-tls-'));
    const fixtures = join(__dirname, 'fixtures', 'source-server-tls');
    const ca = readFileSync(join(fixtures, 'ca.pem'), 'utf8');
    const server = createServer(
        {
            cert: readFileSync(join(fixtures, 'localhost.pem')),
            key: readFileSync(join(fixtures, 'localhost.key')),
        },
        (request, response) => {
            response.setHeader('Content-Type', 'application/json');
            if (request.url === '/api/v1/instance') {
                response.end(
                    JSON.stringify({
                        service: 'iptvnator',
                        apiVersion: 1,
                        storage: 'server',
                        instanceId: 'synthetic-https-instance',
                        capabilities: ['sources-v1'],
                        auth: 'none',
                    })
                );
            } else if (request.url === '/api/v1/sources') {
                response.end(JSON.stringify({ entries: [] }));
            } else {
                response.writeHead(404).end();
            }
        }
    );
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('Missing TLS fixture address');
        desktop = await launchElectronApp(directory, {
            omitEnvKeys: [
                'NODE_EXTRA_CA_CERTS',
                'NODE_USE_SYSTEM_CA',
                'NODE_TLS_REJECT_UNAUTHORIZED',
            ],
        });
        const { electronApp, mainWindow } = desktop;
        const connect = (url: string) =>
            mainWindow.evaluate(
                (url) => window.electron?.sourceSyncConfigure?.(url, '', false),
                url
            );
        const serverUrl = `https://localhost:${address.port}`;
        await expect(connect(serverUrl)).rejects.toThrow('SOURCE_SYNC.OFFLINE');

        // Supply a test CA through Node's system store API without modifying host trust.
        await electronApp.evaluate((_electron, certificate) => {
            const tls = process.getBuiltinModule('node:tls');
            const getCACertificates = Reflect.get(tls, 'getCACertificates') as (
                type: string
            ) => string[];
            Reflect.set(tls, 'getCACertificates', (type: string) =>
                type === 'system' ? [certificate] : getCACertificates(type)
            );
        }, ca);

        await expect(
            connect(`https://127.0.0.1:${address.port}`)
        ).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        await expect(connect(serverUrl)).resolves.toMatchObject({
            apiUrl: `${serverUrl}/api`,
            instanceId: 'synthetic-https-instance',
        });
    } finally {
        if (desktop) await closeElectronApp(desktop);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
    }
});

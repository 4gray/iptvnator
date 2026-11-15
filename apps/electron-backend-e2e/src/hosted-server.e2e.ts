import { once } from 'node:events';
import { get } from 'node:http';
import { get as getTls } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    HOSTED_SERVER_HTTPS_PORT,
    HOSTED_SERVER_PORT,
} from '@iptvnator/shared/interfaces';
import { expect, test, type Locator } from '@playwright/test';
import {
    closeElectronApp,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    workspaceRoot,
} from './electron-test-fixtures';

// Node fetch rewrites Host; exercise a proxy-preserved Host with raw HTTP.
function proxyGet(url: string, options: { headers: Record<string, string> }) {
    return new Promise<{
        status: number;
        json: () => Promise<Record<string, unknown>>;
    }>((resolve, reject) => {
        get(url, options, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () =>
                resolve({
                    status: response.statusCode!,
                    json: async () => JSON.parse(body),
                })
            );
            response.on('error', reject);
        }).on('error', reject);
    });
}

test.skip(
    process.env['IPTVNATOR_E2E_HOSTED_SERVER'] !== '1',
    'Run with the hosted-server Nx target'
);

async function qrAddress(qr: Locator): Promise<string> {
    await expect(qr.locator('svg')).toBeVisible();
    return qr.evaluate((element) => {
        const debug = window as Window & {
            ng?: { getComponent(node: Element): { qrdata: string } };
        };
        if (!debug.ng) throw new Error('Angular debug tools unavailable');
        return debug.ng.getComponent(element).qrdata;
    });
}

test('starts locally, reconnects through the hosted library, and stops on request', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-hosted-e2e-'));
    const origin = `http://127.0.0.1:${HOSTED_SERVER_PORT}`;
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        let page = desktop.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        const setup = page.getByTestId('hosted-access-method');
        await expect(setup).toContainText('Home network');
        await page.getByTestId('hosted-network-address').click();
        await page.getByRole('option', { name: 'This computer only' }).click();
        await page.getByTestId('hosted-server-start').click();
        const status = page.getByTestId('hosted-server-status');
        await expect(status).toHaveText('Server running');
        expect((await fetch(origin + '/workspace/dashboard')).status).toBe(200);
        expect((await fetch(origin + '/api/v1/sources')).status).toBe(401);
        const identity = await (
            await fetch(origin + '/api/v1/instance')
        ).json();
        expect(identity.auth).toBe('token');
        expect(identity.instanceId).toEqual(expect.any(String));
        const qr = page.getByTestId('hosted-device-pair-qr');
        await expect(qr).toHaveCount(0);

        await page.getByTestId('hosted-server-stop').click();
        await expect(status).toHaveText('Server stopped');
        await page
            .getByRole('radio', {
                name: 'External HTTPS proxy (existing setup)',
            })
            .click();
        await expect(page.getByTestId('hosted-server-start')).toBeDisabled();
        await page
            .getByTestId('hosted-https-origin')
            .fill('https://library.example.test');
        await page.getByTestId('hosted-server-start').click();
        await expect(status).toHaveText('Server running');
        await expect(qr).toHaveCount(0);
        const remoteOrigin = 'http://127.0.0.1:' + HOSTED_SERVER_HTTPS_PORT;
        const remoteHeaders = {
            host: 'library.example.test',
            origin: 'https://library.example.test',
        };
        const remoteInstance = () =>
            proxyGet(remoteOrigin + '/api/v1/instance', {
                headers: remoteHeaders,
            }).then((response) => response.json());
        expect((await remoteInstance())['instanceId']).toBe(
            identity.instanceId
        );
        expect(
            (
                await proxyGet(remoteOrigin + '/api/v1/sources', {
                    headers: remoteHeaders,
                })
            ).status
        ).toBe(401);
        expect(
            (
                await proxyGet(remoteOrigin + '/', {
                    headers: {
                        ...remoteHeaders,
                        origin: 'https://other.example.test',
                    },
                })
            ).status
        ).toBe(403);
        await expect(fetch(origin + '/api/health')).rejects.toThrow();

        // Keep the process restart under the fixture's ownership.
        await desktop.electronApp.evaluate(({ app }) => {
            app.relaunch = () => undefined;
            app.exit = () => undefined;
        });
        await page.getByTestId('hosted-server-connect').click();
        await expect
            .poll(async () => {
                try {
                    await remoteInstance();
                    return true;
                } catch {
                    return false;
                }
            })
            .toBe(false);
        await closeElectronApp(desktop);
        desktop = undefined;

        desktop = await launchElectronApp(directory);
        expect(
            await desktop.electronApp.evaluate(
                () => process.env['IPTVNATOR_SOURCE_PROFILE']
            )
        ).toMatch(/^[a-f0-9]{64}$/);
        page = desktop.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('hosted-server-status')).toHaveText(
            'Server running'
        );
        await expect(page.getByTestId('source-server-state')).toContainText(
            'Connected'
        );
        expect((await remoteInstance())['instanceId']).toBe(
            identity.instanceId
        );
        await expect(fetch(origin + '/api/health')).rejects.toThrow();
        const databaseInstanceId = await desktop.electronApp.evaluate(
            (_electron, { dependency, file }) => {
                const Database = process
                    .getBuiltinModule('module')
                    .createRequire(dependency)(dependency);
                const db = new Database(file, {
                    readonly: true,
                    fileMustExist: true,
                });
                try {
                    return db
                        .prepare('SELECT value FROM app_state WHERE key = ?')
                        .get('server:instance-id')?.value;
                } finally {
                    db.close();
                }
            },
            {
                dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
                file: join(
                    directory,
                    'hosted-server',
                    'databases',
                    'iptvnator.db'
                ),
            }
        );
        expect(databaseInstanceId).toBe(identity.instanceId);
        await page.getByTestId('hosted-server-stop').click();
        await expect(page.getByTestId('hosted-server-status')).toHaveText(
            'Server stopped'
        );
        await expect(remoteInstance()).rejects.toThrow();
    } finally {
        if (desktop) await closeElectronApp(desktop);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('lets a paired phone approve a TV and revokes access per device', async ({
    browser,
}) => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-hosted-lan-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('hosted-server-start')).toBeVisible();
        const available = await page.evaluate(async () => {
            const status = await window.electron.hostedServerControl!('status');
            return status.availableAddresses ?? [];
        });
        test.skip(
            !available.length,
            'No private IPv4 interface for the LAN listener'
        );

        await page.getByTestId('hosted-network-address').click();
        await page.getByRole('option', { name: 'This computer only' }).click();
        await page.getByTestId('hosted-server-start').click();
        await expect(page.getByTestId('hosted-server-active-mode')).toHaveText(
            'This computer only'
        );
        await page.getByTestId('hosted-server-share-lan').click();
        const restartShare = page.getByTestId('hosted-server-restart-share');
        await expect(restartShare).toBeDisabled();
        await page.getByTestId('hosted-server-share-address').click();
        await page
            .getByRole('option', { name: available[0], exact: true })
            .click();
        await restartShare.click();
        const openLan = page.getByRole('checkbox', {
            name: 'Allow anyone on the local network',
        });
        await expect(openLan).toBeVisible();
        await expect(openLan).not.toBeChecked();
        const address = page.getByTestId('hosted-server-address');
        await expect(address).toBeVisible();
        const lan = (await address.innerText()).trim();
        expect(new URL(lan).hostname).toBe(available[0]);
        expect((await fetch(lan + '/api/v1/sources')).status).toBe(401);
        await openLan.check();
        await expect
            .poll(async () => {
                try {
                    return (await fetch(lan + '/api/v1/sources')).status;
                } catch {
                    return 0;
                }
            })
            .toBe(200);
        const identity = await (await fetch(lan + '/api/v1/instance')).json();
        expect(identity.auth).toBe('none');
        expect((await fetch(lan + '/api/v1/sources')).status).toBe(200);
        expect(
            (
                await fetch(lan + '/api/v1/favorites/operations', {
                    method: 'POST',
                })
            ).status
        ).toBe(401);
        expect((await fetch(lan + '/api/v1/devices')).status).toBe(403);
        const pairQr = page.getByTestId('hosted-device-pair-qr');
        await expect(pairQr).toHaveCount(0);
        await page.getByRole('button', { name: 'Connect device' }).click();
        expect(new URL(await qrAddress(pairQr)).href).toBe(new URL(lan).href);
        await openLan.uncheck();
        await expect
            .poll(async () => {
                try {
                    return (await fetch(lan + '/api/v1/sources')).status;
                } catch {
                    return 0;
                }
            })
            .toBe(401);
        await expect(pairQr).toHaveCount(0);
        await page.getByTestId('hosted-device-pair').click();
        const invite = new URL(await qrAddress(pairQr));
        expect(invite.origin).toBe(lan.trim());
        expect(invite.pathname).toBe('/pair-device');
        expect(invite.search).toBe('');
        const device = await browser.newPage();
        try {
            await device.goto(invite.href);
            const deepLink = new URL(
                (await device
                    .getByRole('link', { name: 'Open IPTVnator' })
                    .getAttribute('href'))!
            );
            expect(deepLink.protocol).toBe('iptvnator:');
            expect(deepLink.searchParams.get('server')).toBe(invite.origin);
            expect(deepLink.searchParams.get('invite')).toBe(
                invite.hash.slice(1)
            );
            expect(new URL(device.url()).hash).toBe('');

            const post = (path: string, body: object, token?: string) =>
                fetch(`${invite.origin}/api/v1/device-pairing/${path}`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify(body),
                });
            const claimResponse = await post('claim', {
                inviteId: invite.hash.slice(1),
                name: 'Synthetic Android',
            });
            expect(claimResponse.status).toBe(201);
            const { claimId, claimSecret, confirmationCode } =
                await claimResponse.json();
            const finish = () => post('complete', { claimId, claimSecret });
            expect(await (await finish()).json()).toEqual({
                status: 'pending',
            });
            await expect(
                page.getByText(confirmationCode, { exact: true })
            ).toBeVisible();
            await page
                .getByRole('button', { name: 'Codes match, approve' })
                .click();
            await expect(
                page.getByText('Device approved.', { exact: true })
            ).toBeVisible();
            const enrolled = await (await finish()).json();
            expect(enrolled.status).toBe('approved');
            expect(enrolled.instanceId).toBe(identity.instanceId);
            await device.addInitScript(
                ({ token, instanceId }) => {
                    const bridge = {
                        onmessage: null as
                            ((value: { data: string }) => void) | null,
                        postMessage(message: string) {
                            const request = JSON.parse(message);
                            bridge.onmessage?.({
                                data: JSON.stringify({
                                    token:
                                        request.instanceId === instanceId &&
                                        request.action === 'credential'
                                            ? token
                                            : null,
                                }),
                            });
                        },
                    };
                    Reflect.set(window, 'HostedPairing', bridge);
                },
                { token: enrolled.token, instanceId: enrolled.instanceId }
            );
            const authorized = device.waitForResponse(
                (response) =>
                    response.url() === `${invite.origin}/api/v1/sources` &&
                    response.status() === 200
            );
            await device.goto(invite.origin);
            await authorized;

            const tv = await (
                await post('start', { name: 'Synthetic TV' })
            ).json();
            expect(tv.approvalUrl).toBe(
                `${invite.origin}/approve-device/${tv.claimId}`
            );
            expect(tv.approvalUrl).not.toContain(tv.claimSecret);
            await device.goto(tv.approvalUrl);
            await expect(device.getByRole('status')).toContainText(
                'Scan TV QR'
            );
            await expect(
                device.getByLabel('Phone approval password')
            ).toBeHidden();

            const requestTv = () =>
                post('device-request', { claimId: tv.claimId }, enrolled.token);
            expect((await requestTv()).status).toBe(403);
            const phone = page
                .locator('.device-row')
                .filter({ hasText: 'Synthetic Android' });
            const canApprove = phone
                .getByTestId('hosted-device-approval')
                .getByRole('switch');
            await expect(canApprove).toHaveAttribute('aria-checked', 'false');
            await canApprove.click();
            await expect(canApprove).toHaveAttribute('aria-checked', 'true');
            const details = await requestTv();
            expect(details.status).toBe(200);
            expect(await details.json()).toEqual({
                name: 'Synthetic TV',
                confirmationCode: tv.confirmationCode,
            });
            expect(
                (
                    await post(
                        'device-approve',
                        { claimId: tv.claimId },
                        enrolled.token
                    )
                ).status
            ).toBe(204);
            const tvDevice = await (
                await post('complete', {
                    claimId: tv.claimId,
                    claimSecret: tv.claimSecret,
                })
            ).json();
            expect(tvDevice).toMatchObject({
                status: 'approved',
                instanceId: identity.instanceId,
            });

            await canApprove.click();
            await expect(canApprove).toHaveAttribute('aria-checked', 'false');
            expect((await requestTv()).status).toBe(403);
            await phone.getByRole('button', { name: 'Revoke access' }).click();
            await page.getByTestId('confirm-dialog-confirm').click();
            await expect(
                page.getByText('Synthetic Android', { exact: true })
            ).toHaveCount(0);
            expect(
                (
                    await fetch(`${invite.origin}/api/v1/sources`, {
                        headers: { Authorization: `Bearer ${enrolled.token}` },
                    })
                ).status
            ).toBe(401);
            expect(
                (
                    await fetch(`${invite.origin}/api/v1/sources`, {
                        headers: { Authorization: `Bearer ${tvDevice.token}` },
                    })
                ).status
            ).toBe(200);
        } finally {
            await device.close();
        }
        await page.getByTestId('hosted-server-stop').click();
        await expect(page.getByTestId('hosted-server-status')).toHaveText(
            'Server stopped'
        );
    } finally {
        if (desktop) await closeElectronApp(desktop);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('approves and revokes a TV over native HTTPS', async ({ browser }) => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-tv-pairing-'));
    const certificate = join(workspaceRoot, 'apps/web-backend/src/app/testing');
    const cert = join(certificate, 'provider-test.pem');
    const key = join(certificate, 'provider-test.key');
    const portProbe = createServer().listen(0, '127.0.0.1');
    await once(portProbe, 'listening');
    const endpoint = portProbe.address();
    await new Promise<void>((resolve) => portProbe.close(() => resolve()));
    if (!endpoint || typeof endpoint === 'string')
        throw new Error('Expected the HTTPS fixture port');
    const httpsOrigin = 'https://127.0.0.1:' + endpoint.port;
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    const phone = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 390, height: 844 },
    });
    try {
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await page.getByRole('radio', { name: 'Custom HTTPS' }).click();
        await page.getByTestId('hosted-network-address').click();
        await page.getByRole('option', { name: 'This computer only' }).click();
        await page.getByTestId('hosted-https-origin').fill(httpsOrigin);
        await page.getByTestId('hosted-certificate-path').fill(cert);
        await page.getByTestId('hosted-key-path').fill(cert);
        const startServer = page.getByTestId('hosted-server-start');
        await startServer.click();
        await expect(page.getByRole('alert')).toContainText('certificate');
        await expect(fetch(httpsOrigin)).rejects.toThrow();
        await page.getByTestId('hosted-key-path').fill(key);
        await startServer.click();
        await expect(page.getByTestId('hosted-server-status')).toHaveText(
            'Server running'
        );
        await expect(page.getByTestId('hosted-device-pair-qr')).toHaveCount(0);
        await expect(
            fetch('http://127.0.0.1:' + HOSTED_SERVER_PORT)
        ).rejects.toThrow();
        await expect(fetch(httpsOrigin)).rejects.toThrow();

        const verified = await new Promise<number>((resolve, reject) => {
            getTls(
                httpsOrigin + '/api/v1/instance',
                {
                    ca: readFileSync(cert),
                    servername: 'provider.example',
                },
                (response) => {
                    response.resume();
                    resolve(response.statusCode!);
                }
            ).on('error', reject);
        });
        expect(verified).toBe(200);
        await page.getByTestId('hosted-device-pair').click();
        const invite = new URL(
            await qrAddress(page.getByTestId('hosted-device-pair-qr'))
        );
        expect(invite.origin).toBe(httpsOrigin);
        expect(invite.pathname).toBe('/pair-device');
        expect(invite.search).toBe('');
        expect(invite.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
        const tvPost = (action: string, body: object) =>
            phone.request.post(
                httpsOrigin + '/api/v1/device-pairing/' + action,
                { data: body }
            );
        const approval = await phone.newPage();
        const password = approval.getByLabel('Phone approval password');
        const appOnly = await (
            await tvPost('start', { name: 'App-only TV' })
        ).json();
        expect(appOnly.approvalUrl).toBe(
            `${httpsOrigin}/approve-device/${appOnly.claimId}`
        );
        await approval.goto(appOnly.approvalUrl);
        await expect(approval.getByRole('status')).toContainText(
            'Set a phone approval password'
        );
        await expect(password).toBeHidden();

        const ownerPassword = 'synthetic test owner password';
        await page.getByTestId('hosted-browser-pairing-options').click();
        await page
            .getByTestId('hosted-browser-pairing-password')
            .fill(ownerPassword);
        await page.getByTestId('hosted-browser-pairing-save').click();
        await expect(
            page.getByTestId('hosted-browser-pairing-clear')
        ).toBeVisible();

        const start = await tvPost('start', {
            name: 'Synthetic living room TV',
        });
        expect(start.status()).toBe(201);
        const { approvalUrl, claimId, claimSecret, confirmationCode } =
            await start.json();
        expect(approvalUrl).toBe(`${httpsOrigin}/approve-device/${claimId}`);
        expect(approvalUrl).not.toContain(claimSecret);
        const complete = () => tvPost('complete', { claimId, claimSecret });
        expect(await (await complete()).json()).toEqual({ status: 'pending' });

        await approval.goto(approvalUrl);
        await expect(password).toBeVisible();
        await expect(
            approval.getByText('Synthetic living room TV')
        ).toBeHidden();
        expect(new URL(approval.url()).pathname).toBe('/approve-device');
        await password.fill('synthetic incorrect password');
        await approval.getByRole('button', { name: 'Sign in' }).click();
        await expect(approval.getByRole('status')).toContainText(
            'Check the phone approval password'
        );
        expect(await (await complete()).json()).toEqual({ status: 'pending' });
        await password.fill(ownerPassword);
        const details = approval.waitForResponse(
            (response) =>
                response.url().endsWith('/device-pairing/browser-request') &&
                response.status() === 200
        );
        await approval.getByRole('button', { name: 'Sign in' }).click();
        await details;
        await expect(
            approval.getByText('Synthetic living room TV')
        ).toBeVisible();
        await expect(approval.locator('#confirmation-code')).toHaveText(
            confirmationCode
        );
        await approval.goto(approvalUrl);
        await expect(approval.locator('#confirmation-code')).toHaveText(
            confirmationCode
        );
        await expect(password).toBeHidden();
        await approval
            .getByRole('button', { name: 'Codes match, approve TV' })
            .click();
        await expect(approval.getByRole('status')).toContainText('TV approved');
        const enrolled = await (await complete()).json();
        expect(enrolled.status).toBe('approved');
        const identity = await (
            await phone.request.get(httpsOrigin + '/api/v1/instance')
        ).json();
        expect(enrolled.instanceId).toBe(identity.instanceId);
        const headers = { Authorization: `Bearer ${enrolled.token}` };
        expect(
            (
                await phone.request.get(httpsOrigin + '/api/v1/sources', {
                    headers,
                })
            ).status()
        ).toBe(200);

        await expect(
            page.getByRole('button', { name: 'Hide devices' })
        ).toBeVisible();
        const device = page.getByRole('listitem').filter({
            hasText: 'Synthetic living room TV',
        });
        await device.getByRole('button', { name: 'Revoke access' }).click();
        await page.getByTestId('confirm-dialog-confirm').click();
        await expect(
            page.getByText('Device access revoked.', { exact: true })
        ).toBeVisible();
        await expect(device).toHaveCount(0);
        expect(
            (
                await phone.request.get(httpsOrigin + '/api/v1/sources', {
                    headers,
                })
            ).status()
        ).toBe(401);
    } finally {
        await phone.close();
        if (desktop) await closeElectronApp(desktop);
        rmSync(directory, { recursive: true, force: true });
    }
});

test('can disable automatic hosting when the server port is occupied', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-hosted-retry-'));
    const blocker = createServer();
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        await openSettings(desktop.mainWindow);
        await openSettingsSection(desktop.mainWindow, 'server');
        await desktop.mainWindow.evaluate(() =>
            window.electron.hostedServerControl!({
                start: true,
                configuration: { mode: 'lan', address: '', access: 'paired' },
            })
        );
        await expect(
            desktop.mainWindow.getByTestId('hosted-server-status')
        ).toHaveText('Server running');
        await closeElectronApp(desktop);
        desktop = undefined;

        await new Promise<void>((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(HOSTED_SERVER_PORT, '127.0.0.1', resolve);
        });
        desktop = await launchElectronApp(directory);
        await openSettings(desktop.mainWindow);
        await openSettingsSection(desktop.mainWindow, 'server');
        await expect(
            desktop.mainWindow.getByText(
                'The selected server port is in use.',
                {
                    exact: false,
                }
            )
        ).toBeVisible();
        await desktop.mainWindow
            .getByRole('button', { name: 'Disable automatic start' })
            .click();
        await expect(
            desktop.mainWindow.getByTestId('hosted-server-status')
        ).toHaveText('Server stopped');
        await closeElectronApp(desktop);
        desktop = undefined;

        // Keep the port occupied so an unintended restart cannot look successful.
        desktop = await launchElectronApp(directory);
        await openSettings(desktop.mainWindow);
        await openSettingsSection(desktop.mainWindow, 'server');
        await expect(
            desktop.mainWindow.getByTestId('hosted-server-status')
        ).toHaveText('Server stopped');
    } finally {
        if (desktop) await closeElectronApp(desktop);
        if (blocker.listening)
            await new Promise<void>((resolve) =>
                blocker.close(() => resolve())
            );
        rmSync(directory, { recursive: true, force: true });
    }
});

test('starts a tunnel TLS origin on loopback and requires Access for both pages and APIs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-tunnel-e2e-'));
    const certificate = join(workspaceRoot, 'apps/web-backend/src/app/testing');
    const cert = join(certificate, 'provider-test.pem');
    const key = join(certificate, 'provider-test.key');
    const tlsOrigin = `https://127.0.0.1:${HOSTED_SERVER_HTTPS_PORT}`;
    const publicOrigin = 'https://library.example.test';
    const read = (path: string) =>
        new Promise<number>((resolve, reject) => {
            getTls(
                tlsOrigin + path,
                {
                    ca: readFileSync(cert),
                    servername: 'provider.example',
                    headers: { Host: new URL(publicOrigin).host },
                },
                (response) => {
                    response.resume();
                    resolve(response.statusCode!);
                }
            ).on('error', reject);
        });
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        const status = await page.evaluate(
            ({ origin, certificatePath, keyPath }) =>
                window.electron.hostedServerControl!({
                    start: true,
                    configuration: {
                        mode: 'cloudflare',
                        origin,
                        certificatePath,
                        keyPath,
                        team: 'example-team',
                        audience: 'a'.repeat(64),
                        managed: false,
                    },
                }),
            { origin: publicOrigin, certificatePath: cert, keyPath: key }
        );
        expect(status).toMatchObject({
            state: 'running',
            mode: 'cloudflare',
            endpoint: publicOrigin,
        });
        expect(status.lanUrl).toBeUndefined();
        await expect(
            fetch(`http://127.0.0.1:${HOSTED_SERVER_PORT}`)
        ).rejects.toThrow();
        await expect(read('/')).resolves.toBe(403);
        await expect(read('/api/v1/instance')).resolves.toBe(403);
        await openSettings(page);
        await openSettingsSection(page, 'server');
        await expect(page.getByTestId('hosted-device-pair')).toHaveCount(0);
        await page.getByTestId('hosted-server-stop').click();
        await expect(page.getByTestId('hosted-server-status')).toHaveText(
            'Server stopped'
        );
        await expect(read('/')).rejects.toThrow();
    } finally {
        if (desktop) await closeElectronApp(desktop);
        rmSync(directory, { recursive: true, force: true });
    }
});

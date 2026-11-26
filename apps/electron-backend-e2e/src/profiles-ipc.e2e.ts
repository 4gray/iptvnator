import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { closeElectronApp, launchElectronApp } from './electron-test-fixtures';
import { startSourceSyncServer } from './source-sync-test-server';

test.skip(
    process.env['IPTVNATOR_E2E_SOURCE_SYNC'] !== '1',
    'Run with playwright.source-sync.config.ts'
);
test.use({ actionTimeout: 20000, navigationTimeout: 30000 });

const send = (page: Page, request: SourceServerRequest) =>
    page.evaluate((request) => {
        const send = window.electron.sourceSyncRequest;
        if (!send) throw new Error('Missing source request bridge');
        return send(request);
    }, request) as Promise<SourceServerResponse>;

test('drives the household profile operations through the desktop IPC route @electron @persistence', async ({
    request,
}) => {
    const server = await startSourceSyncServer();
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-profiles-ipc-'));
    let desktop: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
        const instance = await (
            await request.get(`${server.apiUrl}/v1/instance`)
        ).json();
        expect(instance.capabilities).toContain('profiles-v1');
        writeFileSync(
            join(directory, 'source-server.json'),
            JSON.stringify({
                apiUrl: server.apiUrl,
                instanceId: instance.instanceId,
            })
        );
        desktop = await launchElectronApp(directory);
        const page = desktop.mainWindow;
        const connection = () =>
            page.evaluate(() => window.electron.sourceSyncConnection?.());

        const first = await send(page, { operation: 'profiles-list' });
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({
            enabled: false,
            profiles: [{ id: 'default', kids: false, hasPin: false }],
        });
        const revision = (first.body as { revision: number }).revision;

        const unchanged = await send(page, {
            operation: 'profiles-list',
            revision: String(revision),
        });
        expect(unchanged.status).toBe(304);

        const enabled = await send(page, {
            operation: 'profiles-set-enabled',
            profile: { enabled: true },
        });
        expect(enabled).toMatchObject({
            status: 200,
            body: { enabled: true },
        });

        const created = await send(page, {
            operation: 'profile-create',
            profile: { name: 'Synthetic Ana', pin: '1234' },
        });
        expect(created.status).toBe(201);
        const ana = created.body as { id: string; hasPin: boolean };
        expect(ana.hasPin).toBe(true);
        const other = await send(page, {
            operation: 'profile-create',
            profile: { name: 'Synthetic Bo' },
        });
        expect(other.status).toBe(201);
        const bo = other.body as { id: string };

        // A wrong PIN is an answer, not a broken connection.
        const before = await connection();
        const wrong = await send(page, {
            operation: 'profile-update',
            id: ana.id,
            profile: { name: 'Nope', currentPin: '9999', pin: null },
        });
        expect(wrong).toMatchObject({
            status: 403,
            body: { code: 'wrong_pin' },
        });
        const wrongUnlock = await send(page, {
            operation: 'profile-unlock',
            id: ana.id,
            profile: { pin: '0000' },
        });
        expect(wrongUnlock.status).toBe(403);
        expect(await connection()).toEqual(before);
        expect((await send(page, { operation: 'profiles-list' })).status).toBe(
            200
        );

        const updated = await send(page, {
            operation: 'profile-update',
            id: ana.id,
            profile: { name: 'Synthetic Ana 2', currentPin: '1234' },
        });
        expect(updated).toMatchObject({
            status: 200,
            body: { name: 'Synthetic Ana 2' },
        });
        const unlocked = await send(page, {
            operation: 'profile-unlock',
            id: ana.id,
            profile: { pin: '1234' },
        });
        expect(unlocked.status).toBe(200);

        const ordered = await send(page, {
            operation: 'profiles-order',
            profile: { ids: ['default', bo.id, ana.id] },
        });
        expect(ordered.status).toBe(200);
        expect(
            (ordered.body as { profiles: { id: string }[] }).profiles.map(
                (profile) => profile.id
            )
        ).toEqual(['default', bo.id, ana.id]);

        // 204 has no body and must not be read as a broken response.
        const removedBo = await send(page, {
            operation: 'profile-delete',
            id: bo.id,
        });
        expect(removedBo.status).toBe(204);
        const removedAna = await send(page, {
            operation: 'profile-delete',
            id: ana.id,
            profile: { currentPin: '1234' },
        });
        expect(removedAna.status).toBe(204);

        const off = await send(page, {
            operation: 'profiles-set-enabled',
            profile: { enabled: false },
        });
        expect(off).toMatchObject({ status: 200, body: { enabled: false } });
        const last = await send(page, { operation: 'profiles-list' });
        expect((last.body as { profiles: unknown[] }).profiles).toHaveLength(1);
        expect(await connection()).toEqual(before);
    } finally {
        if (desktop) await closeElectronApp(desktop);
        await server.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

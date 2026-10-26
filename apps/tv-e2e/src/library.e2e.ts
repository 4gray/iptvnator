import { tvOrigins } from '../ports';
import {
    test,
    expect,
    type Page,
    type APIRequestContext,
} from '@playwright/test';
import { addSource, backend, nav, stalker, start, xtream } from './helpers';
import type { UserData } from '@iptvnator/tv/util';
const server = tvOrigins.library;
const headers = { Authorization: 'Bearer tv-library-test' };
const libraryDocument = (id: string, fields: Record<string, unknown> = {}) => ({
    _id: id,
    title: `Shared ${id}`,
    importDate: '',
    lastUsage: '',
    autoRefresh: false,
    count: 0,
    ...fields,
});
async function put(
    request: APIRequestContext,
    id: string,
    fields: Record<string, unknown>
) {
    const response = await request.put(`${server}/v1/playlists/${id}`, {
        headers,
        data: libraryDocument(id, fields),
    });
    expect(response.ok()).toBeTruthy();
}
async function connect(page: Page) {
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Library & sync', exact: false })
        .click();
    const pane = page.getByRole('region', { name: 'Server library' });
    await pane.getByLabel('Library server URL').fill(server);
    await pane
        .getByLabel('Library access token (if required)')
        .fill('tv-library-test');
    await pane
        .getByRole('button', { name: 'Connect library', exact: true })
        .click();
    await expect(pane.getByRole('status')).toContainText('Connected');
    return pane;
}
async function snapshot(page: Page) {
    return page.evaluate(
        async () =>
            new Promise<UserData>((resolve) => {
                const req = indexedDB.open('iptvnator-tv-user-data');
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('state');
                    const item = tx.objectStore('state').get('user');
                    tx.oncomplete = () => {
                        resolve(item.result?.data);
                        db.close();
                    };
                };
            })
    );
}
test.beforeEach(async ({ request }) => {
    expect(
        (await request.delete(`${server}/v1/playlists`, { headers })).ok()
    ).toBeTruthy();
});
test('source replacement leaves stale details and keeps new playback under the replacement identity', async ({
    page,
    request,
}) => {
    for (const id of ['a', 'b'])
        await put(request, id, {
            serverUrl: xtream,
            username: 'user1',
            password: 'pass1',
        });
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await connect(page);
    await nav(page, 'Sources');
    await page
        .locator('.source-row')
        .filter({ hasText: 'Shared a' })
        .getByRole('button')
        .first()
        .click();
    const original = (await snapshot(page)).activeId;
    await nav(page, 'Movies');
    await page.locator('.poster-grid .poster-card').first().click();
    await expect(page.locator('.detail-hero')).toBeVisible();
    expect(
        (await request.delete(`${server}/v1/playlists/a`, { headers })).ok()
    ).toBeTruthy();
    await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange'))
    );
    await expect
        .poll(async () => (await snapshot(page)).activeId)
        .not.toBe(original);
    await expect(page.locator('.detail-hero')).toHaveCount(0);
    await expect(page.locator('[data-focus="nav:home"]')).toHaveAttribute(
        'aria-current',
        'page'
    );
    const replacement = (await snapshot(page)).activeId;
    await nav(page, 'Movies');
    const card = page.locator('.poster-grid .poster-card').first();
    const key = await card.getAttribute('data-focus');
    await card.click();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(async () => (await snapshot(page)).history[0]?.item.sourceId)
        .toBe(replacement);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="detail-play"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
        page.locator('.poster-grid .poster-card').first()
    ).toHaveAttribute('data-focus', key!);
    await expect(
        page.locator('.poster-grid .poster-card').first()
    ).toBeFocused();
});
test('library removal of the active source resets Live categories for the replacement provider', async ({
    page,
    request,
}) => {
    await put(request, 'xtream', {
        serverUrl: xtream,
        username: 'user1',
        password: 'pass1',
    });
    await put(request, 'stalker', {
        portalUrl: `${stalker}/server/load.php`,
        macAddress: '00:1a:79:00:00:03',
    });
    await start(page);
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByRole('button', { name: 'Check and connect' }).click();
    await connect(page);
    await nav(page, 'Sources');
    await page
        .locator('.source-row')
        .filter({ hasText: 'Shared xtream' })
        .getByRole('button')
        .first()
        .click();
    const original = (await snapshot(page)).activeId;
    await nav(page, 'TV', false);
    await page.locator('.live-category').nth(1).click();
    await expect(page.locator('.channel-pane-header')).toBeVisible();
    expect(
        (
            await request.delete(`${server}/v1/playlists/xtream`, { headers })
        ).ok()
    ).toBeTruthy();
    await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange'))
    );
    await expect
        .poll(async () => (await snapshot(page)).activeId)
        .not.toBe(original);
    await expect(page.locator('[data-focus="live-category:"]')).toBeVisible();
    await expect(page.locator('[data-focus="live-category:"]')).toBeFocused();
    await page.locator('[data-focus="live-category:"]').click();
    await expect(page.locator('.channel').first()).toBeVisible();
    await expect(page.locator('.channel-pane-header')).toContainText(
        'All channels'
    );
});
test('renaming a retained server source preserves MAG identity; an explicit MAC edit normalizes it', async ({
    page,
    request,
}) => {
    const original = '00:1a:79:19:44:03';
    const identity = {
        serialNumber: ' serial ',
        deviceId1: ' device-1 ',
        deviceId2: ' device-2 ',
        signature1: ' signature-1 ',
        signature2: ' signature-2 ',
    };
    await put(request, 'mac-edit', {
        stalkerSerialNumber: identity.serialNumber,
        stalkerDeviceId1: identity.deviceId1,
        stalkerDeviceId2: identity.deviceId2,
        stalkerSignature1: identity.signature1,
        stalkerSignature2: identity.signature2,
        portalUrl: `${stalker}/server/load.php`,
        macAddress: original,
    });
    await start(page);
    await addSource(page, 'xtream');
    const pane = await connect(page);
    await pane.getByRole('button', { name: 'Disconnect library' }).click();
    await expect(pane.getByRole('status')).toContainText('Disconnected');
    await nav(page, 'Sources');
    await page
        .locator('.source-row')
        .filter({ hasText: 'Shared mac-edit' })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
    await page.getByLabel('MAC address').focus();
    await page.keyboard.press('Tab');
    await page.getByLabel('Name', { exact: true }).fill('Renamed portal');
    await page.getByRole('button', { name: 'Save and connect' }).click();
    await expect
        .poll(
            async () =>
                (await snapshot(page)).sources.find(
                    (s) => s.name === 'Renamed portal'
                )?.macAddress
        )
        .toBe(original);
    expect(
        (await snapshot(page)).sources.find((s) => s.name === 'Renamed portal')
    ).toMatchObject(identity);
    await page.reload();
    await nav(page, 'Sources');
    await page
        .locator('.source-row')
        .filter({ hasText: 'Renamed portal' })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
    expect(
        (await snapshot(page)).sources.find((s) => s.name === 'Renamed portal')
    ).toMatchObject(identity);
    await page.getByLabel('MAC address').fill('00-1a-79-19-44-04');
    await page.getByRole('button', { name: 'Save and connect' }).click();
    await expect
        .poll(
            async () =>
                (await snapshot(page)).sources.find(
                    (s) => s.name === 'Renamed portal'
                )?.macAddress
        )
        .toBe('00:1A:79:19:44:04');
});
test('shared Xtream, Stalker and M3U sources load, retain local identity and survive relaunch', async ({
    page,
    request,
}) => {
    await put(request, 'xtream', {
        serverUrl: xtream,
        username: 'user1',
        password: 'pass1',
    });
    await put(request, 'stalker', {
        portalUrl: `${stalker}/server/load.php`,
        macAddress: '00:1a:79:00:00:03',
    });
    await put(request, 'm3u', { url: `${xtream}/playlist.m3u` });
    await put(request, 'file', {
        playlist: {
            items: [
                {
                    name: 'Stored TV channel',
                    url: `${xtream}/stored-live.ts`,
                },
            ],
        },
    });
    await start(page);
    await addSource(page, 'xtream');
    const original = (await snapshot(page)).activeId;
    await connect(page);
    expect((await snapshot(page)).activeId).toBe(original);
    expect((await snapshot(page)).sources).toHaveLength(4);
    for (const name of [
        'Shared xtream',
        'Shared stalker',
        'Shared m3u',
        'Shared file',
    ]) {
        await nav(page, 'Sources');
        await page
            .locator('.source-row')
            .getByRole('button', { name: new RegExp(name) })
            .click();
        await expect(page.locator('.loading')).toBeHidden({ timeout: 25000 });
        await nav(page, 'TV');
        await expect(page.locator('.channel').first()).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
    expect((await snapshot(page)).sources).toHaveLength(4);
    await put(request, 'xtream', {
        title: 'Renamed on server',
        serverUrl: xtream,
        username: 'user1',
        password: 'pass1',
    });
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Library & sync', exact: false })
        .click();
    await page.getByRole('button', { name: 'Refresh library now' }).click();
    await expect
        .poll(async () =>
            (await snapshot(page)).sources.some(
                (s) => s.name === 'Renamed on server'
            )
        )
        .toBeTruthy();
    expect(
        (await snapshot(page)).sources.find(
            (s) => s.name === 'Renamed on server'
        )?.id
    ).toBe(original);
});
test('auth/offline/replaced instance preserve cache; disconnect restores original local source', async ({
    page,
    request,
}) => {
    await put(request, 'xtream', {
        serverUrl: xtream,
        username: 'user1',
        password: 'pass1',
    });
    await start(page);
    await addSource(page, 'xtream');
    const pane = await connect(page);
    await page.route(`${server}/v1/playlists**`, (route) => route.abort());
    await pane.getByRole('button', { name: 'Refresh library now' }).click();
    await expect(pane.getByRole('alert')).toContainText('unavailable');
    expect((await snapshot(page)).sources[0].name).toBe('Shared xtream');
    await page.unroute(`${server}/v1/playlists**`);
    let protectedRequests = 0;
    await page.route(`${server}/v1/**`, async (route) => {
        if (route.request().headers()['authorization']) protectedRequests++;
        if (route.request().url().endsWith('/instance'))
            await route.fulfill({
                json: {
                    service: 'iptvnator',
                    apiVersion: 1,
                    storage: 'server',
                    auth: 'token',
                    instanceId: 'replacement',
                },
            });
        else await route.continue();
    });
    await pane.getByRole('button', { name: 'Refresh library now' }).click();
    await expect(pane.getByRole('alert')).toContainText('has changed');
    expect(protectedRequests).toBe(0);
    await page.unroute(`${server}/v1/**`);
    await pane.getByRole('button', { name: 'Disconnect library' }).click();
    await expect(pane.getByRole('status')).toContainText('Disconnected');
    expect((await snapshot(page)).sources[0].name).toBe('TV xtream');
    await pane.getByLabel('Library server URL').fill(server);
    await pane.getByLabel('Library access token (if required)').fill('wrong');
    await pane
        .getByRole('button', { name: 'Connect library', exact: true })
        .click();
    await expect(pane.getByRole('alert')).toContainText('access denied');
    expect((await snapshot(page)).library).toBeUndefined();
});
test('explicit source upload uses real server storage, is idempotent and preserves unrelated server data', async ({
    page,
    request,
}) => {
    await start(page);
    await addSource(page, 'm3u');
    const before = await snapshot(page);
    const pane = await connect(page);
    await pane
        .getByLabel('Local source to copy to server')
        .selectOption(before.activeId);
    await pane.getByRole('button', { name: 'Copy source to server' }).click();
    await expect(pane.getByRole('status')).toContainText('1 server sources');
    const response = await request.get(`${server}/v1/playlists`, { headers });
    const list = await response.json();
    expect(list).toHaveLength(1);
    expect(list[0]._id).toBe(before.activeId);
    expect(list[0].url).toBe(`${xtream}/playlist.m3u`);
    await pane.getByRole('button', { name: 'Refresh library now' }).click();
    await expect(pane.getByRole('status')).toContainText('Connected');
    expect((await snapshot(page)).sources).toHaveLength(1);
    await request.delete(
        `${server}/v1/playlists/${encodeURIComponent(before.activeId)}`,
        { headers }
    );
    await pane.getByRole('button', { name: 'Refresh library now' }).click();
    await expect(pane.getByRole('status')).toContainText('0 server sources');
    expect((await snapshot(page)).sources[0].id).toBe(before.activeId);
});

test('a library reply cannot interrupt playback or reconnect after disconnect', async ({
    page,
    request,
}) => {
    await put(request, 'xtream', {
        serverUrl: xtream,
        username: 'user1',
        password: 'pass1',
    });
    await start(page);
    await addSource(page, 'xtream');
    await connect(page);
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
        started = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`${server}/v1/playlists?view=meta`, async (route) => {
        started();
        await held;
        await route
            .fulfill({
                json: [
                    libraryDocument('xtream', {
                        title: 'Late replacement',
                        serverUrl: 'http://example.invalid',
                        username: 'user1',
                        password: 'changed',
                    }),
                ],
            })
            .catch(() => undefined);
    });
    await page.getByRole('button', { name: 'Refresh library now' }).click();
    await pending;
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate(
                    (v: HTMLVideoElement) => !v.paused && v.currentTime > 0
                )
        )
        .toBeTruthy();
    const response = page.waitForResponse(`${server}/v1/playlists?view=meta`);
    release();
    await (await response).finished();
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    await expect
        .poll(async () => (await snapshot(page)).sources[0].name)
        .toBe('Shared xtream');
    await page.keyboard.press('Escape');
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Library & sync', exact: false })
        .click();
    await expect(
        page.getByRole('region', { name: 'Server library' }).getByRole('alert')
    ).toContainText('deferred');
    let releaseAgain!: () => void;
    let startedAgain!: () => void;
    const pendingAgain = new Promise<void>((resolve) => {
        startedAgain = resolve;
    });
    const heldAgain = new Promise<void>((resolve) => {
        releaseAgain = resolve;
    });
    await page.unroute(`${server}/v1/playlists?view=meta`);
    await page.route(`${server}/v1/playlists?view=meta`, async (route) => {
        startedAgain();
        await heldAgain;
        await route.fulfill({ json: [] }).catch(() => undefined);
    });
    await page.getByRole('button', { name: 'Refresh library now' }).click();
    await pendingAgain;
    await page.getByRole('button', { name: 'Disconnect library' }).click();
    releaseAgain();
    await expect(
        page.getByRole('region', { name: 'Server library' }).getByRole('status')
    ).toContainText('Disconnected');
    expect((await snapshot(page)).library).toBeUndefined();
    expect((await snapshot(page)).sources[0].name).toBe('TV xtream');
});

test('repointing a server row separates old favorites and resume from the new account', async ({
    page,
    request,
}) => {
    await put(request, 'account', {
        serverUrl: xtream,
        username: 'user1',
        password: 'pass1',
    });
    await start(page);
    await addSource(page, 'xtream');
    await connect(page);
    const original = (await snapshot(page)).activeId;
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page
        .getByRole('button', { name: '♡ Add to favorites', exact: true })
        .click();
    await expect
        .poll(async () => (await snapshot(page)).favorites.length)
        .toBe(1);
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(async () => (await snapshot(page)).history[0]?.item.sourceId)
        .toBe(original);
    await page.keyboard.press('Escape');
    await expect(page.locator('.detail-hero')).toBeVisible();
    const savedFavorite = (await snapshot(page)).favorites[0];
    await put(request, 'account', {
        serverUrl: xtream,
        username: 'large',
        password: 'large',
    });
    await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange'))
    );
    await expect
        .poll(async () => (await snapshot(page)).activeId)
        .not.toBe(original);
    await expect(page.locator('.detail-hero')).toHaveCount(0);
    const replacement = (await snapshot(page)).activeId;
    expect((await snapshot(page)).favorites[0]).toEqual(savedFavorite);
    expect((await snapshot(page)).history[0].item.sourceId).toBe(original);
    await nav(page, 'Favorites');
    await expect(page.locator('.poster-card')).toHaveCount(0);
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await page.locator('[data-focus="detail-play"]').click();
    await expect
        .poll(async () => (await snapshot(page)).history[0]?.item.sourceId)
        .toBe(replacement);
    await page.reload();
    await expect
        .poll(async () => (await snapshot(page)).activeId)
        .toBe(replacement);
    expect((await snapshot(page)).favorites[0]).toEqual(savedFavorite);
});

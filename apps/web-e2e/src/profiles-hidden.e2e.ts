import { expect, test } from './fixtures';
import {
    STORAGE_BACKEND_URL,
    newServerPage,
} from './server-storage-pwa.helpers';

/**
 * Household profiles ship hidden (PROFILES_UI_ENABLED is false) until the
 * per-profile state lands. This pins the hidden state against a real server
 * that already has profiles turned on: nothing may reach for them.
 */
test.use({ serviceWorkers: 'block', testIdAttribute: 'data-test-id' });

test.describe('household profiles stay hidden @self-hosted', () => {
    // One shared server database: keep it to one browser, one test at a time.
    test.describe.configure({ mode: 'serial' });
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'One shared server database'
    );

    let profileId = '';
    let headers: Record<string, string> = {};

    test.beforeEach(async ({ request }) => {
        const instance = await (
            await request.get(`${STORAGE_BACKEND_URL}/v1/instance`)
        ).json();
        expect(instance.capabilities).toContain('profiles-v1');
        headers = { 'X-IPTVnator-Instance-Id': instance.instanceId };
        const enabled = await request.patch(
            `${STORAGE_BACKEND_URL}/v1/profiles`,
            {
                headers,
                data: { enabled: true },
            }
        );
        expect(enabled.ok()).toBe(true);
        const created = await request.post(
            `${STORAGE_BACKEND_URL}/v1/profiles`,
            {
                headers,
                data: { name: 'Synthetic Ana' },
            }
        );
        expect(created.ok()).toBe(true);
        profileId = (await created.json()).id;
    });

    test.afterEach(async ({ request }) => {
        await request.delete(
            `${STORAGE_BACKEND_URL}/v1/profiles/${profileId}`,
            {
                headers,
            }
        );
        await request.patch(`${STORAGE_BACKEND_URL}/v1/profiles`, {
            headers,
            data: { enabled: false },
        });
    });

    test('start-up never asks, never calls /v1/profiles and shows no Profiles section', async ({
        browser,
        request,
    }) => {
        const list = await request.get(`${STORAGE_BACKEND_URL}/v1/profiles`, {
            headers,
        });
        expect((await list.json()).enabled).toBe(true);

        const page = await newServerPage(browser);
        const profileRequests: string[] = [];
        page.on('request', (value) => {
            if (new URL(value.url()).pathname.includes('/v1/profiles'))
                profileRequests.push(value.url());
        });
        try {
            await page.goto('/workspace/sources');
            await expect(page).toHaveURL(/\/workspace\/sources$/);
            await expect(
                page.getByRole('heading', { name: /who.?s watching/i })
            ).toHaveCount(0);

            await page.goto('/workspace/settings');
            await expect(page.getByTestId('settings-container')).toBeVisible();
            await expect(
                page.getByRole('link', { name: 'Profiles', exact: true })
            ).toHaveCount(0);
            await expect(
                page.getByRole('tab', { name: 'Profiles', exact: true })
            ).toHaveCount(0);

            // The picker route exists only while the switch is on.
            await page.goto('/profile-picker');
            await expect(page).toHaveURL(/\/workspace/);
            await expect(page).not.toHaveURL(/profile-picker/);

            expect(profileRequests).toEqual([]);
        } finally {
            await page.context().close();
        }
    });
});

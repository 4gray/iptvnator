import { type APIRequestContext, type Page } from '@playwright/test';
import { setInputValue } from './e2e-helpers';
import { expect, test } from './fixtures';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

/**
 * Stalker full-portal authentication E2E.
 *
 * `stalker.e2e.ts` imports the portal through the tolerant `/portal.php` alias,
 * which the app classifies as a "simple" portal: no handshake, no token, no
 * watchdog. This file covers the other half — the canonical Ministra endpoint
 * (`/stalker_portal/server/load.php`), which the mock server guards exactly
 * like the real middleware:
 *
 *   - every action except handshake/get_profile/get_localization/do_auth needs
 *     `Authorization: Bearer <token>`
 *   - a token only counts once `get_profile` has adopted it
 *   - auth failures come back as HTTP 200 with a plain-text body, never a 401
 *
 * Tag: @stalker
 */

const MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
const MOCK_SERVER = `http://localhost:${MOCK_PORT}`;
/** Canonical Ministra path — the app treats this as a full (authenticated) portal. */
const FULL_PORTAL_URL = `${MOCK_SERVER}/stalker_portal/server/load.php`;
const BACKEND_PROXY = `${MOCK_SERVER}/stalker`;

const DEFAULT_MAC = '00:1A:79:00:00:01';

async function interceptStalkerRequests(page: Page): Promise<void> {
    const providerTargets = await interceptProviderTargetRegistration(page);

    await page.route('**/localhost:3000/stalker**', async (route) => {
        const originalUrl = new URL(route.request().url());
        const mockUrl = new URL(BACKEND_PROXY);
        const providerUrl = getRegisteredProviderUrl(
            originalUrl,
            providerTargets
        );

        if (providerUrl) {
            mockUrl.searchParams.set('url', providerUrl);
        }

        originalUrl.searchParams.forEach((value, key) => {
            if (key === 'targetId') {
                return;
            }
            mockUrl.searchParams.set(key, value);
        });
        await route.continue({ url: mockUrl.toString() });
    });
}

async function resetMockServer(request: APIRequestContext): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await request.post(`${MOCK_SERVER}/reset`);
        if (response.ok()) {
            return;
        }
    }
    throw new Error('Could not reset the stalker mock server');
}

async function addFullStalkerPortal(
    page: Page,
    options: { name?: string; mac?: string } = {}
): Promise<void> {
    const { name = 'Full Stalker Portal', mac = DEFAULT_MAC } = options;

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();

    await setInputValue(dialog.locator('input#title'), name);
    await setInputValue(dialog.locator('input#portalUrl'), FULL_PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), mac);

    const addButton = dialog.getByRole('button', { name: 'Add', exact: true });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/stalker.*vod/, { timeout: 30_000 });
}

/** Portal actions the app sent, in order, as seen on the proxy boundary. */
function recordPortalActions(page: Page): {
    actions: string[];
    tokensByAction: Map<string, string | null>;
} {
    const actions: string[] = [];
    const tokensByAction = new Map<string, string | null>();

    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!url.pathname.endsWith('/stalker')) {
            return;
        }
        const action = url.searchParams.get('action');
        if (!action) {
            return;
        }
        actions.push(action);
        if (!tokensByAction.has(action)) {
            tokensByAction.set(action, url.searchParams.get('token'));
        }
    });

    return { actions, tokensByAction };
}

test.beforeEach(async ({ page, request }) => {
    // Importing a full portal costs a handshake, a profile call and the first
    // content load — on a cold dev server that alone approaches Playwright's
    // 30s default budget, so give these tests explicit headroom.
    test.setTimeout(90_000);

    await resetMockServer(request);
    await page.goto('/');
    await interceptStalkerRequests(page);
});

test.describe('@stalker full portal authentication', () => {
    test('handshakes and authenticates before loading content', async ({
        page,
    }) => {
        const { actions, tokensByAction } = recordPortalActions(page);

        await addFullStalkerPortal(page);

        // The portal only answers content actions for an adopted token, so
        // reaching the VOD categories at all proves the whole chain ran.
        await expect(page.locator('.category-item').first()).toBeVisible({
            timeout: 30_000,
        });

        expect(actions).toContain('handshake');
        expect(actions).toContain('get_profile');
        expect(actions.indexOf('handshake')).toBeLessThan(
            actions.indexOf('get_profile')
        );

        const contentAction = actions.find((action) =>
            ['get_categories', 'get_genres'].includes(action)
        );
        expect(contentAction).toBeDefined();
        expect(actions.indexOf('get_profile')).toBeLessThan(
            actions.indexOf(contentAction as string)
        );

        // Content requests must carry the token; the handshake must not.
        expect(tokensByAction.get('handshake')).toBeFalsy();
        expect(tokensByAction.get(contentAction as string)).toBeTruthy();
    });

    test('never surfaces the portal plain-text auth failure as content', async ({
        page,
    }) => {
        await addFullStalkerPortal(page);

        // A body of "Authorization failed." must never be rendered — if the
        // token pipeline breaks, the app has to fail loudly instead.
        await expect(page.locator('body')).not.toContainText(
            'Authorization failed.'
        );
        await expect(page.locator('body')).not.toContainText(
            'Unauthorized request.'
        );
    });

    test('re-authenticates after the portal drops the session', async ({
        page,
        request,
    }) => {
        await addFullStalkerPortal(page);

        const { actions } = recordPortalActions(page);

        // Server-side session loss is what a real expired/replaced token looks
        // like: the next request gets "Authorization failed." with HTTP 200.
        const invalidated = await request.post(
            `${MOCK_SERVER}/invalidate-session?macAddress=${encodeURIComponent(
                DEFAULT_MAC
            )}`
        );
        expect(invalidated.ok()).toBe(true);

        // Navigating to another content type forces a fresh portal request.
        await page.getByRole('link', { name: /live|itv/i }).click();

        await expect
            .poll(() => actions.filter((a) => a === 'handshake').length, {
                timeout: 30_000,
            })
            .toBeGreaterThan(0);

        await expect(page.locator('body')).not.toContainText(
            'Authorization failed.'
        );
    });
});

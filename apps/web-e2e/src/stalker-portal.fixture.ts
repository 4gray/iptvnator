import type { Page } from '@playwright/test';
import { setInputValue } from './e2e-helpers';
import { expect } from './fixtures';
import {
    getRegisteredProviderUrl,
    interceptProviderTargetRegistration,
} from './provider-target-route';

/**
 * Mock-portal endpoints, scenario MACs and page helpers of `stalker.e2e.ts`.
 *
 * The scenario MACs declared here belong to that spec alone: it lists them in
 * its `OWNED_MACS` and resets them before every test, so a sibling spec that
 * reused one would have its mock state cleared mid-run. See the isolation
 * notes at the top of `stalker.e2e.ts`.
 */

const MOCK_PORT = process.env['MOCK_PORT'] ?? '3210';
export const MOCK_SERVER = `http://localhost:${MOCK_PORT}`;
const PORTAL_URL = `${MOCK_SERVER}/portal.php`;
/**
 * Canonical Ministra path. `PORTAL_URL` above is classified by the app as a
 * "simple" portal (no handshake, no token, no watchdog); this shape is the
 * authenticated branch, which the mock guards like the real middleware.
 */
export const FULL_PORTAL_URL = `${MOCK_SERVER}/stalker_portal/server/load.php`;
export const BACKEND_PROXY = `${MOCK_SERVER}/stalker`;

/** Default scenario MAC — balanced catalog, 8 categories, 40 items */
export const DEFAULT_MAC = '00:1A:79:00:00:01';

/** Minimal scenario MAC — 2 categories, 5 items (edge case testing) */
export const MINIMAL_MAC = '00:1A:79:00:00:03';

/** Embedded-series MAC — 50% of VOD items carry an embedded series[] array */
export const EMBEDDED_SERIES_MAC = '00:1A:79:00:00:05';

/** Legacy pagination MAC — portal without get_all_channels support */
export const LEGACY_PAGINATION_MAC = '00:1A:79:00:00:06';

/**
 * Static-cmd MAC — ITV rows carrying a directly playable `cmd` with
 * `use_http_tmp_link` and `use_load_balancing` both `'0'`, i.e. a portal that
 * expects no `create_link` call at all.
 */
export const STATIC_CMD_MAC = '00:1A:79:00:00:0A';

/**
 * The full-portal authentication tests assert state transitions within one
 * portal session, so a reset from a concurrent browser project or repeat
 * worker would invalidate the assertion itself. Giving every concurrent
 * worker slot its own MAC range preserves browser parallelism and also keeps
 * `--repeat-each` runs isolated.
 */
export interface StatefulAuthMacs {
    authenticatedFlow: string;
    loginRequired: string;
    tokenReuse: string;
    deviceConflict: string;
    reauthentication: string;
}

export function getStatefulAuthMacs({
    parallelIndex,
}: {
    parallelIndex: number;
}): StatefulAuthMacs {
    if (
        !Number.isSafeInteger(parallelIndex) ||
        parallelIndex < 0 ||
        parallelIndex > 255
    ) {
        throw new Error(
            `Unsupported Playwright parallel index: ${parallelIndex}`
        );
    }

    const workerOctet = parallelIndex
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    const workerPrefix = `00:1A:79:AE:${workerOctet}`;

    return {
        authenticatedFlow: `${workerPrefix}:01`,
        loginRequired: `${workerPrefix}:02`,
        tokenReuse: `${workerPrefix}:03`,
        deviceConflict: `${workerPrefix}:04`,
        reauthentication: `${workerPrefix}:05`,
    };
}

/**
 * Deliberately NOT an Infomir MAC: the strict endpoint rejects get_profile for
 * it, so no token is ever adopted and content requests fail permanently.
 */
export const AUTH_REJECTED_MAC = 'AA:BB:CC:DD:EE:01';

/**
 * Intercept calls to the Angular dev backend (/stalker proxy) and redirect
 * them to the mock server. This avoids needing a real backend or changing
 * any app environment configuration.
 */
export async function interceptStalkerRequests(page: Page): Promise<void> {
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

/**
 * Add a Stalker portal via the UI:
 * 1. Click the "add playlist" button to open the unified dialog
 * 2. Select "Stalker" toggle
 * 3. Fill in the form and submit
 */
export async function addStalkerPortal(
    page: Page,
    options: { name?: string; mac?: string } = {}
): Promise<void> {
    const { name = 'Mock Stalker Portal', mac = DEFAULT_MAC } = options;

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    // v0.22 redesign: tabs were replaced with a flat 5-card radio picker.
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();

    await setInputValue(dialog.locator('input#title'), name);
    await setInputValue(dialog.locator('input#portalUrl'), PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), mac);

    const addButton = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(/stalker.*vod/);
}

/**
 * Add a Stalker portal through the canonical Ministra URL, which the app
 * imports as a FULL portal: handshake, Bearer token and watchdog.
 */
export async function addFullStalkerPortal(
    page: Page,
    options: {
        name?: string;
        mac: string;
        expectContent?: boolean;
        username?: string;
        password?: string;
    }
): Promise<void> {
    const {
        name = 'Full Stalker Portal',
        mac,
        expectContent = true,
        username,
        password,
    } = options;

    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Stalker portal/i }).click();

    await setInputValue(dialog.locator('input#title'), name);
    await setInputValue(dialog.locator('input#portalUrl'), FULL_PORTAL_URL);
    await setInputValue(dialog.locator('input#macAddress'), mac);
    if (username !== undefined) {
        await setInputValue(dialog.locator('input#username'), username);
    }
    if (password !== undefined) {
        await setInputValue(dialog.locator('input#password'), password);
    }

    const addButton = dialog.getByRole('button', {
        name: 'Add playlist',
        exact: true,
    });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(dialog).toBeHidden();

    if (expectContent) {
        await page.waitForURL(/stalker.*vod/, { timeout: 30_000 });
    }
}

export const CONTENT_ACTIONS = [
    'get_categories',
    'get_genres',
    'get_ordered_list',
    'get_all_channels',
];

/** Every portal request in order, with the token it carried. */
export function recordPortalRequests(
    page: Page
): Array<{ action: string; token: string | null }> {
    const requests: Array<{ action: string; token: string | null }> = [];

    page.on('request', (request) => {
        const url = new URL(request.url());
        if (!url.pathname.endsWith('/stalker')) {
            return;
        }
        const action = url.searchParams.get('action');
        if (!action) {
            return;
        }
        requests.push({ action, token: url.searchParams.get('token') });
    });

    return requests;
}

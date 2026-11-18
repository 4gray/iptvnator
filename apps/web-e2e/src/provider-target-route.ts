import { type Page } from '@playwright/test';
import { test } from './fixtures';

interface ProviderTargetPayload {
    readonly url: string;
}

const BACKEND_ORIGIN = 'http://localhost:3000';

function mockProviderCorsHeaders() {
    const { baseURL } = test.info().project.use;
    return {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-origin': new URL(
            baseURL ?? 'http://localhost:4200'
        ).origin,
    };
}

/** Pin standalone provider specs to the mocked stateless backend in every build. */
export async function configureMockProviderBackend(page: Page): Promise<void> {
    const headers = mockProviderCorsHeaders();
    await page.route('**/assets/app-config.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: ${JSON.stringify(BACKEND_ORIGIN)} };`,
        })
    );
    await page.route(`${BACKEND_ORIGIN}/v1/instance`, (route) =>
        route.fulfill({
            contentType: 'application/json',
            headers,
            body: JSON.stringify({
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: null,
                storage: 'none',
                auth: 'none',
            }),
        })
    );
}

export async function interceptProviderTargetRegistration(
    page: Page
): Promise<Map<string, string>> {
    const providerTargets = new Map<string, string>();
    const headers = mockProviderCorsHeaders();

    await page.route(`${BACKEND_ORIGIN}/provider-targets**`, async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({
                body: '',
                headers,
                status: 200,
            });
            return;
        }

        const providerUrl = getProviderUrl(route.request().postDataJSON());
        if (!providerUrl) {
            await route.fulfill({
                body: JSON.stringify({
                    message: 'Missing url',
                    status: 400,
                }),
                contentType: 'application/json',
                headers,
                status: 400,
            });
            return;
        }

        const targetId = Buffer.from(providerUrl).toString('base64url');
        providerTargets.set(targetId, providerUrl);

        await route.fulfill({
            body: JSON.stringify({ targetId }),
            contentType: 'application/json',
            headers,
            status: 200,
        });
    });

    return providerTargets;
}

export function getRegisteredProviderUrl(
    url: URL,
    providerTargets: ReadonlyMap<string, string>
): string | null {
    const targetId = url.searchParams.get('targetId');
    if (!targetId) {
        return url.searchParams.get('url');
    }

    return providerTargets.get(targetId) ?? null;
}

function getProviderUrl(value: unknown): string | null {
    if (
        value &&
        typeof value === 'object' &&
        'url' in value &&
        typeof (value as Partial<ProviderTargetPayload>).url === 'string'
    ) {
        return (value as ProviderTargetPayload).url;
    }

    return null;
}

import { type Page } from '@playwright/test';

interface ProviderTargetPayload {
    readonly url: string;
}

const BACKEND_ORIGIN = 'http://localhost:3000';
const CORS_HEADERS = {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-origin': 'http://localhost:4200',
} as const;

export async function interceptProviderTargetRegistration(
    page: Page
): Promise<Map<string, string>> {
    const providerTargets = new Map<string, string>();

    await page.route(`${BACKEND_ORIGIN}/provider-targets**`, async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({
                body: '',
                headers: CORS_HEADERS,
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
                headers: CORS_HEADERS,
                status: 400,
            });
            return;
        }

        const targetId = Buffer.from(providerUrl).toString('base64url');
        providerTargets.set(targetId, providerUrl);

        await route.fulfill({
            body: JSON.stringify({ targetId }),
            contentType: 'application/json',
            headers: CORS_HEADERS,
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

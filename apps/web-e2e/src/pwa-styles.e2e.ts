import { expect, test } from '@playwright/test';

// eslint-disable-next-line playwright/no-skipped-test -- Static PWA assertions require the built service worker artifact.
test.skip(
    process.env['IPTVNATOR_E2E_STATIC_PWA'] !== '1',
    'Static PWA stylesheet regression test only runs against the built PWA output.'
);

test('@pwa-static PWA build applies the full stylesheet under CSP', async ({
    page,
}) => {
    const cspConsoleErrors: string[] = [];
    page.on('console', (message) => {
        if (
            message.type() === 'error' &&
            /content security policy|inline event handler|onload/i.test(
                message.text()
            )
        ) {
            cspConsoleErrors.push(message.text());
        }
    });

    await page.goto('/');

    const stylesheetLinks = page.locator('link[rel="stylesheet"]');
    await expect(stylesheetLinks.first()).toBeAttached();

    const stylesheetMedia = await stylesheetLinks.evaluateAll((links) =>
        links.map((link) => ({
            href: link.getAttribute('href'),
            media: link.getAttribute('media'),
        }))
    );

    const appStylesheet = stylesheetMedia.find((link) =>
        /(?:^|\/)styles-.*\.css$/.test(link.href ?? '')
    );
    expect(appStylesheet).toBeDefined();
    expect(appStylesheet?.media).not.toBe('print');

    const materialIcon = page.locator('mat-icon.material-icons').first();
    await expect(materialIcon).toBeVisible();

    await expect
        .poll(() =>
            materialIcon.evaluate((icon) =>
                getComputedStyle(icon).fontFamily.toLowerCase()
            )
        )
        .toContain('material icons');

    await expect
        .poll(() =>
            page.evaluate(() =>
                document.fonts.check('24px "Material Icons"')
            )
        )
        .toBe(true);

    const ngswResponse = await page.request.get('/ngsw.json');
    await expect(ngswResponse).toBeOK();

    const ngswManifest = (await ngswResponse.json()) as {
        assetGroups?: Array<{ urls?: string[] }>;
    };
    const cachedUrls = ngswManifest.assetGroups?.flatMap(
        (assetGroup) => assetGroup.urls ?? []
    );

    expect(cachedUrls).toEqual(
        expect.arrayContaining([expect.stringMatching(/^(?:\.\/|\/)media\//)])
    );
    expect(cspConsoleErrors).toEqual([]);
});

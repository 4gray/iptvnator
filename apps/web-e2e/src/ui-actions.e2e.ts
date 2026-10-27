import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    addStalkerPortal,
    addXtreamPortal,
    interceptPwaProviderRequests,
    STALKER_PORTAL_URL,
} from './sources-pwa.helpers';

async function expectSecondary(button: Locator, radius = '10px') {
    for (const dark of [false, true]) {
        await button.evaluate(
            (element, value) =>
                element.ownerDocument.body.classList.toggle(
                    'dark-theme',
                    value
                ),
            dark
        );
        await expect(button).toHaveCSS('border-top-left-radius', radius);
        await expect(button).toHaveCSS('border-top-style', 'none');
    }
}

test('@ui @stalker additional fields survive folding, import and editing', async ({
    page,
}) => {
    await interceptPwaProviderRequests(page);
    await page.goto('/');
    await page
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.getByRole('radio', { name: /^Stalker portal/ }).click();
    const form = dialog.locator('app-stalker-portal-import');
    const summary = form.locator('summary');
    await expect(form.locator('#serialNumber')).toBeHidden();
    await summary.press('Enter');
    await expect(form.locator('#serialNumber')).toBeVisible();
    await form.locator('#title').fill('UI identity fixture');
    await form.locator('#portalUrl').fill(STALKER_PORTAL_URL);
    await form.locator('#macAddress').fill('00:1A:79:5F:09:01');
    await form.locator('#serialNumber').fill('SN-UI');
    await form.locator('#deviceId1').fill('PINNED-UI-1');
    await form.locator('#deviceId2').fill('PINNED-UI-2');
    await form.locator('#signature1').fill('SIG-UI-1');
    await form.locator('#signature2').fill('SIG-UI-2');
    await form.locator('#username').fill('fixture-user');
    await form.locator('#password').fill('fixture-password');
    await summary.click();
    await expect(form.locator('#password')).toBeHidden();
    await dialog
        .getByRole('button', { name: 'Add playlist', exact: true })
        .click();
    await expect(dialog).toBeHidden();

    await page.locator('[data-test-id="playlist-switcher-trigger"]').click();
    const row = page
        .locator('[role="option"]')
        .filter({ hasText: 'UI identity fixture' });
    await row.locator('.source-row__more').click();
    await page
        .getByRole('menuitem', { name: 'Playlist info', exact: true })
        .click();
    const edit = page.locator('app-playlist-info');
    await expect(edit.locator('details')).toHaveAttribute('open', '');
    await expect(
        edit.locator('[formControlName="stalkerSerialNumber"]')
    ).toHaveValue('SN-UI');
    await expect(
        edit.locator('[formControlName="stalkerDeviceId1"]')
    ).toHaveValue('PINNED-UI-1');
    await expect(
        edit.locator('[formControlName="stalkerDeviceId2"]')
    ).toHaveValue('PINNED-UI-2');
    await expect(
        edit.locator('[formControlName="stalkerSignature1"]')
    ).toHaveValue('SIG-UI-1');
    await expect(
        edit.locator('[formControlName="stalkerSignature2"]')
    ).toHaveValue('SIG-UI-2');
    await expect(edit.locator('[formControlName="username"]')).toHaveValue(
        'fixture-user'
    );
    await expect(edit.locator('[formControlName="password"]')).toHaveValue(
        'fixture-password'
    );
    await expect(edit.locator('[formControlName="password"]')).toHaveAttribute(
        'type',
        'password'
    );
    await edit.locator('summary').click();
    await edit.locator('[formControlName="title"]').fill('UI identity renamed');
    await edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(edit).toBeHidden();
});

test('@ui @stalker search and catalog retry actions keep recovery reachable', async ({
    page,
}, testInfo) => {
    await interceptPwaProviderRequests(page);
    await page.goto('/');
    await addStalkerPortal(page, 'UI retries');
    let failInitial = true;
    let failAppend = true;
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get('action') !== 'get_ordered_list')
            return route.fallback();
        const isSearch = params.get('search') === 'UI retries';
        const isCategory =
            params.get('category') !== '*' && !params.get('search');
        if (!isSearch && !isCategory) return route.fallback();
        const append = Number(params.get('p') ?? '1') > 1;
        if ((isSearch && failInitial) || (append && failAppend)) {
            return route.fulfill({ status: 503, body: 'Fixture unavailable' });
        }
        return route.fulfill({
            json: {
                payload: {
                    js: {
                        data: [
                            {
                                id: append ? '99002' : '99001',
                                name: append ? 'Recovered item' : 'UI result',
                                category_id: '2001',
                                cmd: '/fixture.mp4',
                            },
                        ],
                        total_items: 2,
                        max_page_items: 1,
                        cur_page: append ? 2 : 1,
                    },
                },
            },
        });
    });
    await page
        .getByRole('link', { name: 'Advanced search', exact: true })
        .click();
    await expect(page).toHaveURL(/search$/);
    await page.goto(`${page.url()}?q=UI%20retries`);
    const initialRetry = page.locator('.search-error button');
    await expect(initialRetry).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('search-error.png') });
    await expectSecondary(initialRetry);
    failInitial = false;
    await initialRetry.click();
    const appendRetry = page.locator('.search-append-error button');
    await expect(appendRetry).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('search-append-error.png'),
    });
    await expectSecondary(appendRetry);
    failAppend = false;
    await appendRetry.click();
    await expect(
        page.getByText('Recovered item', { exact: true })
    ).toBeVisible();
    await expect(appendRetry).toBeHidden();

    failAppend = true;
    await page.getByRole('link', { name: 'Movies', exact: true }).click();
    await page
        .locator('app-workspace-context-panel .category-item')
        .nth(1)
        .click();
    const catalogRetry = page.locator('.grid-list__tail--error button');
    await expect(catalogRetry).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('catalog-append-error.png'),
    });
    await expectSecondary(catalogRetry);
    failAppend = false;
    await catalogRetry.click();
    await expect(
        page.getByText('Recovered item', { exact: true })
    ).toBeVisible();
    await expect(catalogRetry).toBeHidden();
});

test('@ui @xtream hidden channel list offers a styled restore action', async ({
    page,
}, testInfo) => {
    await interceptPwaProviderRequests(page);
    await page.goto('/');
    await addXtreamPortal(page, 'UI hidden channels');
    await page.getByRole('link', { name: 'Live TV', exact: true }).click();
    await page
        .locator('app-workspace-context-panel .category-item')
        .first()
        .click();
    await page
        .getByRole('button', { name: 'Hide channels list', exact: true })
        .click();
    const restore = page.locator('app-channel-list-hidden-state button');
    await expect(restore).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('hidden-list.png') });
    await expectSecondary(restore);
    await restore.click();
    await expect(restore).toBeHidden();
});

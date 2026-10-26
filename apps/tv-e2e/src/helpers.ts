import { tvOrigins, tvPorts } from '../ports';
import { expect, Page } from '@playwright/test';
import { resolve } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
export const backend = tvOrigins.backend;
export const xtream = tvOrigins.xtream;
export const stalker = tvOrigins.stalker;
export async function start(page: Page) {
    await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.includes('/tv-test-media.webm')) {
            await route.fulfill({
                path: resolve(
                    workspaceRoot,
                    'apps/web-e2e/src/fixtures/playback/episode.webm'
                ),
                contentType: 'video/webm',
            });
            return;
        }
        if (
            /\/(live|movie|series)\/[^/]+\/[^/]+\//.test(url) ||
            url.includes('example.channels') ||
            (url.includes('/stream/') && !url.includes('/stalker?'))
        ) {
            await route.fulfill({
                status: 302,
                headers: {
                    Location: `${xtream}/tv-test-media.webm`,
                    'Access-Control-Allow-Origin': '*',
                },
            });
            return;
        }
        if (
            /^https?:\/\//.test(url) &&
            !(
                new URL(url).protocol === 'http:' &&
                ['localhost', '127.0.0.1'].includes(new URL(url).hostname) &&
                Object.values(tvPorts).includes(Number(new URL(url).port))
            )
        ) {
            await route.abort();
            return;
        }
        await route.continue();
    });
    await page.goto('/');
    await expect(
        page.getByRole('heading', { name: 'Sources', exact: true })
    ).toBeVisible();
}
export async function addSource(
    page: Page,
    type: 'xtream' | 'stalker' | 'm3u',
    options: {
        url?: string;
        username?: string;
        password?: string;
        mac?: string;
    } = {}
) {
    await page
        .getByRole('navigation')
        .getByRole('button', { name: 'Sources' })
        .click();
    await page
        .getByRole('button', { name: type.toUpperCase(), exact: true })
        .click();
    await page.getByLabel('IPTVnator backend URL').fill(backend);
    await page.getByLabel('Name', { exact: true }).fill(`TV ${type}`);
    await page
        .getByLabel(type === 'm3u' ? 'Playlist URL' : 'Provider URL')
        .fill(
            options.url ??
                (type === 'stalker'
                    ? `${stalker}/server/load.php`
                    : type === 'm3u'
                      ? `${xtream}/playlist.m3u`
                      : xtream)
        );
    if (type !== 'm3u') {
        await page
            .getByLabel(/^Username/)
            .fill(options.username ?? (type === 'xtream' ? 'user1' : ''));
        await page
            .getByLabel('Password', { exact: true })
            .fill(options.password ?? (type === 'xtream' ? 'pass1' : ''));
    }
    if (type === 'stalker')
        await page
            .getByLabel('MAC address')
            .fill(options.mac ?? '00:1a:79:00:00:03');
    await page.getByRole('button', { name: 'Save and connect' }).click();
    await expect(page.locator('.source-form')).toHaveCount(0);
    await expect(page.locator('.loading')).toBeHidden({ timeout: 25000 });
    await expect(page.locator('.error')).toBeHidden();
}
export async function nav(page: Page, label: string, openAllChannels = true) {
    await page
        .getByRole('navigation')
        .getByRole('button', { name: label, exact: true })
        .click();
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    await expect(page.locator('.loading')).toBeHidden();
    if (label === 'TV' && openAllChannels) {
        await page.locator('[data-focus="live-category:"]').click();
        await expect(page.locator('.channel-pane-header button')).toBeVisible();
        await expect(page.locator('.channel').first()).toBeFocused();
    }
}

import { expect, Page, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#275947"/><circle cx="1250" cy="300" r="230" fill="#d6b884"/></svg>';
const details = (id: string) => ({
    id: Number(id),
    title: 'Fictional TMDB fixture',
    overview: `TMDB description ${id}`,
    poster_path: '/poster.jpg',
    backdrop_path: `/wide-${id}.jpg`,
    original_language: 'en',
    videos: { results: [{ site: 'YouTube', key: 'fixture', type: 'Trailer' }] },
});
async function setup(page: Page) {
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await page.route('https://image.tmdb.org/**', (route) =>
        route.fulfill({ contentType: 'image/svg+xml', body: svg })
    );
}
async function enable(page: Page, key = 'fake-tv-key') {
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await page.getByLabel('Use TMDB metadata').check();
    await page.getByLabel('TMDB API key or read access token').fill(key);
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
}
test('@tmdb opt-in, key validation, language and relaunch preserve provider identity', async ({
    page,
}) => {
    await setup(page);
    const requests: { path: string; authorization?: string }[] = [];
    await page.route('https://api.themoviedb.org/3/**', async (route) => {
        const url = new URL(route.request().url());
        requests.push({
            path: url.href,
            authorization: route.request().headers()['authorization'],
        });
        const body = url.pathname.includes('/search/')
            ? {
                  results: [
                      {
                          id: 701,
                          title: url.searchParams.get('query'),
                          name: url.searchParams.get('query'),
                          first_air_date: '1900-01-01',
                      },
                  ],
              }
            : url.pathname.endsWith('/configuration')
              ? {}
              : details(url.pathname.split('/').pop() ?? '701');
        await route.fulfill({ json: body });
    });
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.loading')).toBeHidden();
    expect(requests).toHaveLength(0);
    await enable(page);
    await page.getByRole('button', { name: 'Check TMDB key' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toHaveText(
        'TMDB key is valid.'
    );
    expect(requests[0].path).toContain('api_key=fake-tv-key');
    await page.getByLabel('Metadata language').selectOption('de');
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
    await nav(page, 'Home');
    await expect(page.locator('.hero p')).toContainText('TMDB description');
    await expect(page.locator('.page-backdrop img')).toHaveAttribute(
        'src',
        /image\.tmdb\.org/
    );
    await page.getByRole('button', { name: 'Explore title' }).click();
    await expect(page.locator('.detail-hero p')).toContainText(
        'TMDB description'
    );
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect(page.locator('video[src], video source')).toHaveAttribute(
        'src',
        /\/movie\/marketing\/marketing\/\d+\.mkv$/
    );
    await page.reload();
    await nav(page, 'Settings');
    await page
        .getByRole('tab', { name: 'Metadata · TMDB', exact: false })
        .click();
    await expect(page.getByLabel('Use TMDB metadata')).toBeChecked();
    await expect(
        page.getByLabel('TMDB API key or read access token')
    ).toHaveValue('fake-tv-key');
    await expect(page.getByLabel('Metadata language')).toHaveValue('de');
    expect(
        requests.some((request) => request.path.includes('language=de-DE'))
    ).toBe(true);
    await page
        .getByLabel('TMDB API key or read access token')
        .fill('eyJ.fake-tv-read-token');
    await page.getByRole('button', { name: 'Check TMDB key' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toHaveText(
        'TMDB key is valid. Save your changes to use this key and language.'
    );
    const bearer = requests.find(
        (request) => request.authorization === 'Bearer eyJ.fake-tv-read-token'
    );
    expect(bearer?.path).not.toContain('api_key=');
    expect(bearer).toBeDefined();
    await page.getByLabel('Use TMDB metadata').uncheck();
    await page.getByRole('button', { name: 'Save TMDB settings' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'saved'
    );
    const count = requests.length;
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.loading')).toBeHidden();
    await expect(page.locator('.detail-hero p')).not.toContainText(
        'TMDB description'
    );
    expect(requests.length).toBe(count);
});
test('@tmdb invalid credentials never block provider details or native playback', async ({
    page,
}) => {
    await setup(page);
    await page.route('https://api.themoviedb.org/3/**', (route) =>
        route.fulfill({ status: 401, json: { status_code: 7 } })
    );
    await enable(page, 'invalid-fixture-key');
    await page.getByRole('button', { name: 'Check TMDB key' }).click();
    await expect(page.locator('.tmdb-settings [role=status]')).toContainText(
        'could not validate'
    );
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect(page.locator('.metadata-notice')).toContainText(
        'Showing provider information'
    );
    await expect(page.locator('.detail-hero p')).not.toBeEmpty();
    await page.getByRole('button', { name: 'Watch now' }).click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((video) => (video as HTMLVideoElement).currentTime)
        )
        .toBeGreaterThan(0.2);
});
test('@tmdb late metadata cannot replace a new selection and broken artwork keeps the page usable', async ({
    page,
}) => {
    await setup(page);
    let release: (() => void) | undefined;
    let firstId = '';
    await page.route('https://api.themoviedb.org/3/**', async (route) => {
        const url = new URL(route.request().url());
        const id = url.pathname.split('/').pop() ?? '';
        if (!firstId) {
            firstId = id;
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        }
        await route.fulfill({ json: details(id) }).catch(() => undefined);
    });
    await enable(page);
    await nav(page, 'Movies');
    await page.locator('.poster-card').first().click();
    await expect.poll(() => !!release).toBe(true);
    await page
        .getByRole('button', { name: 'Back', exact: false })
        .first()
        .click();
    await page.locator('.poster-card').nth(1).click();
    await expect(page.locator('.detail-hero p')).toContainText(
        'TMDB description'
    );
    const title = await page.locator('.detail-hero h1').textContent();
    const plot = await page.locator('.detail-hero p').textContent();
    expect(plot).not.toBe(`TMDB description ${firstId}`);
    release?.();
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            )
    );
    await expect(page.locator('.detail-hero h1')).toHaveText(title ?? '');
    await expect(page.locator('.detail-hero p')).toHaveText(plot ?? '');
    await page.route('https://image.tmdb.org/**', (route) => route.abort());
    await page
        .getByRole('button', { name: 'Back', exact: false })
        .first()
        .click();
    await page.locator('.poster-card').nth(2).click();
    await expect(page.locator('.page-backdrop img')).toHaveAttribute(
        'src',
        /image\.tmdb\.org/
    );
    await expect(page.locator('.page-backdrop img')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Watch now' })).toBeVisible();
});

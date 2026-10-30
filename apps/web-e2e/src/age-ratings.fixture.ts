import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { setSwitch } from './e2e-helpers';

/** Deterministic fictional metadata; never contacts a real metadata service. */
export async function interceptAgeRatingTmdb(page: Page) {
    let requests = 0;
    let searchYear = '2020';
    const mediaTypes: string[] = [];
    await page.route('https://api.themoviedb.org/**', async (route) => {
        requests++;
        const url = new URL(route.request().url());
        const json = (body: unknown) => route.fulfill({ json: body });
        if (url.pathname.includes('/search/')) {
            const title =
                url.searchParams.get('query') || 'Classification Fixture';
            const year =
                url.searchParams.get('year') ||
                url.searchParams.get('first_air_date_year') ||
                searchYear;
            return json({
                results: [
                    {
                        id: 904201,
                        title,
                        original_title: title,
                        name: title,
                        original_name: title,
                        release_date: `${year}-01-01`,
                        first_air_date: `${year}-01-01`,
                        vote_count: 100,
                    },
                ],
            });
        }
        const match = url.pathname.match(/\/(movie|tv)\/(\d+)$/);
        if (match) {
            const mediaType = match[1];
            mediaTypes.push(mediaType);
            return json({
                id: Number(match[2]),
                title: 'Classification Fixture',
                name: 'Classification Fixture',
                overview:
                    'A fictional metadata fixture for classification checks.',
                original_language: 'en',
                credits: { cast: [], crew: [] },
                videos: { results: [] },
                ...(mediaType === 'movie'
                    ? {
                          release_dates: {
                              results: [
                                  {
                                      iso_3166_1: 'DE',
                                      release_dates: [
                                          { certification: '12', type: 4 },
                                      ],
                                  },
                                  {
                                      iso_3166_1: 'US',
                                      release_dates: [
                                          { certification: 'PG-13', type: 4 },
                                      ],
                                  },
                              ],
                          },
                      }
                    : {
                          content_ratings: {
                              results: [
                                  { iso_3166_1: 'DE', rating: '16' },
                                  { iso_3166_1: 'US', rating: 'TV-14' },
                              ],
                          },
                          aggregate_credits: { cast: [] },
                      }),
            });
        }
        return json({});
    });
    return {
        requests: () => requests,
        mediaTypes,
        setYear: (year: string) => {
            searchYear = year;
        },
    };
}

export async function setAgeRatingCountry(
    page: Page,
    country: string,
    enableTmdb = false
) {
    if (page.url() === 'about:blank') {
        await page.goto('/workspace/settings/tmdb');
    } else {
        await page.getByRole('link', { name: 'Open settings' }).click();
        await page.locator('[data-test-id="settings-section-tmdb"]').click();
    }
    const selector = page.locator('[data-test-id="age-rating-country"]');
    await expect(selector).toBeVisible();
    await selector.click();
    await page
        .getByRole('option', { name: new RegExp(`\\(${country}\\)$`) })
        .click();
    if (enableTmdb) {
        await setSwitch(
            page.locator('[data-test-id="tmdb-enabled"] [role="switch"]'),
            true
        );
        await page
            .locator('[data-test-id="tmdb-api-key"]')
            .fill('fictional-e2e-key');
    }
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click();
    await expect(save).toBeHidden();
}

export function ageRating(page: Page) {
    return page.locator(
        'app-age-rating-chip:visible [data-test-id="age-rating-chip"]'
    );
}

/** Use the saved theme so body tokens and the hero's own scrim agree. */
export async function setAgeRatingTheme(
    page: Page,
    theme: 'Light' | 'Dark',
    detailUrl: string
) {
    await page.getByRole('link', { name: 'Open settings' }).click();
    await page.locator('[data-test-id="settings-section-general"]').click();
    await page
        .locator('[data-test-id="select-theme"]')
        .getByRole('radio', { name: theme, exact: true })
        .click();
    const save = page.locator('[data-test-id="save-settings"]');
    await save.click();
    await expect(save).toBeHidden();
    await page.locator('[data-test-id="workspace-header-back"]').click();
    await expect(page).toHaveURL(detailUrl);
    await expect(page.locator('mat-snack-bar-container')).toHaveCount(0);
}

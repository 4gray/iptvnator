import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { CLIP_TITLE, importPlaylist } from './player-settings-panel.fixture';
import {
    addM3uUrlPlaylist,
    addXtreamPortal,
    interceptPwaProviderRequests,
    openSourceEditor,
    openSources,
    resetPwaMockServers,
    sourceRowByTitle,
    XTREAM_MOCK_SERVER,
} from './sources-pwa.helpers';

/**
 * Every icon-only button on the main surfaces has an accessible name: axe's
 * `button-name` rule over the whole page on a channel list in the player
 * sidebar, the channel details dialog, the Sources list, the playlist info
 * dialog and an Xtream catalog search. `pnpm run a11y:icon-buttons:validate` checks the
 * templates statically; this checks the rendered names, so a label bound to
 * an empty value fails too.
 */

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const M3U_TITLE = 'Icon Button Names M3U';
const XTREAM_TITLE = 'Icon Button Names Xtream';

interface ButtonNameAudit {
    violations: string[];
    checked: number;
}

/** Runs axe's `button-name` rule over `scope`. */
async function auditButtonNames(scope: Locator): Promise<ButtonNameAudit> {
    await scope.page().evaluate(AXE_SOURCE);
    return scope.evaluate(async (element) => {
        const axe = (window as unknown as { axe: typeof import('axe-core') })
            .axe;
        const results = await axe.run(element, {
            runOnly: { type: 'rule', values: ['button-name'] },
            resultTypes: ['violations', 'passes'],
        });
        const nodes = (kind: 'violations' | 'passes') =>
            results[kind].flatMap((rule) => rule.nodes);
        return {
            violations: nodes('violations').map(
                (node) => `${node.target.join(' ')}: ${node.html}`
            ),
            checked: nodes('violations').length + nodes('passes').length,
        };
    });
}

/**
 * No nameless button on the page (dialogs included), which shows at least
 * `minimum` buttons.
 */
async function expectNamedButtons(page: Page, minimum: number) {
    const audit = await auditButtonNames(page.locator('body'));
    expect(audit.violations).toEqual([]);
    expect(audit.checked).toBeGreaterThanOrEqual(minimum);
}

async function closeDialog(page: Page, dialog: Locator) {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page, request }) => {
    await resetPwaMockServers(request);
    await interceptPwaProviderRequests(page);
    await page.goto('/');
});

test('@a11y icon-only buttons are named in a channel list and its details', async ({
    page,
}) => {
    await importPlaylist(page);

    // Channel list in the player sidebar: the favorite toggle and the row
    // actions.
    const channel = page
        .locator('app-sidebar app-channel-list-item')
        .filter({ hasText: CLIP_TITLE });
    await expect(channel).toBeVisible();
    await channel.hover();
    await expectNamedButtons(page, 5);

    // The favorite toggle keeps one name and reports its state.
    const favorite = channel.locator('.favorite-button');
    await expect(favorite).toHaveAccessibleName('Favorite');
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(favorite).toHaveAccessibleName('Favorite');

    // Channel details dialog: the copy button next to the stream URL.
    await channel.locator('.channel-content').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show channel details' }).click();
    const details = page.locator('mat-dialog-container').last();
    await expect(
        details.getByRole('button', { name: 'Copy stream URL' })
    ).toBeVisible();
    await expectNamedButtons(page, 1);
    await closeDialog(page, details);
});

test('@a11y icon-only buttons are named in Sources and the playlist info dialog', async ({
    page,
}) => {
    await addM3uUrlPlaylist(page, M3U_TITLE);

    // Sources list: refresh, details and remove on each row.
    await openSources(page);
    const row = sourceRowByTitle(page, M3U_TITLE);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.hover();
    for (const name of [
        'Refresh playlist',
        'Show playlist details',
        'Remove playlist',
    ]) {
        await expect(row.getByRole('button', { name })).toBeAttached();
    }
    await expectNamedButtons(page, 3);

    // Playlist info dialog, with an EPG source row and its remove button.
    const info = await openSourceEditor(page, M3U_TITLE);
    await info.getByRole('button', { name: 'Add EPG source' }).click();
    await expect(
        info.getByRole('button', { name: 'Remove EPG source' }).last()
    ).toBeVisible();
    await expect(
        info.getByRole('button', { name: 'Copy URL to clipboard' })
    ).toBeVisible();
    await expectNamedButtons(page, 3);
    await closeDialog(page, info);
});

test('@a11y icon-only buttons are named in an Xtream catalog search', async ({
    page,
    request,
}) => {
    await addXtreamPortal(page, XTREAM_TITLE);

    // Search for a word from a movie the portal serves, so the results grid
    // renders cards. The PWA searches the catalog it holds in memory, so stay
    // in the app instead of reloading into the search route.
    const response = await request.get(
        `${XTREAM_MOCK_SERVER}/player_api.php?username=user1&password=pass1&action=get_vod_streams`
    );
    expect(response.ok()).toBeTruthy();
    const [movie] = (await response.json()) as { name: string }[];
    const term = movie.name
        .split(/[^\p{L}\p{N}]+/u)
        .reduce((longest, word) =>
            word.length > longest.length ? word : longest
        );

    await page.getByRole('link', { name: 'Advanced search' }).click();
    await page.waitForURL(/\/search/);
    const searchBox = page.getByRole('searchbox', { name: 'Search' });
    await searchBox.fill(term);
    await searchBox.press('Enter');
    await expect(
        page.locator('app-search-results app-content-card').first()
    ).toBeVisible({ timeout: 15_000 });
    await expectNamedButtons(page, 1);
});

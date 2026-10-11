import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    test,
    workspaceRoot,
} from './electron-test-fixtures';

/**
 * Layout of the playback diagnostic banner in the M3U inline player, which
 * sits above the EPG panel and is about 400px tall in the default window.
 *
 * Every locale's card labels and "player started" status are written into the
 * rendered cards instead of being reached through the cards: activating an
 * external-player card can launch a real MPV or VLC installed on the machine.
 */

const I18N_DIR = join(workspaceRoot, 'apps/web/src/assets/i18n');

/** Every label a recommendation card can show (playback-recommendation-view.util.ts). */
const CARD_LABEL_KEYS = [
    'ACTION_OPEN_MPV',
    'ACTION_OPEN_VLC',
    'ACTION_OPENING_MPV',
    'ACTION_OPENING_VLC',
    'ACTION_REOPEN_MPV',
    'ACTION_REOPEN_VLC',
    'ACTION_RETRY_MPV',
    'ACTION_RETRY_VLC',
    'ACTION_RETRY',
    'ACTION_TRY_PLAYER',
] as const;

type CardText = { label: string; locale: string; status: string };

type CardLayout = {
    /** Labels whose text is wider than their box (ellipsized or overflowing). */
    truncated: string[];
    /** Texts whose banner content leaves the visible banner box. */
    clipped: string[];
    /** Texts whose content was taller than the player, so the banner scrolled. */
    scrolled: number;
};

function cardTexts(): CardText[] {
    return readdirSync(I18N_DIR)
        .filter((file) => file.endsWith('.json'))
        .flatMap((file) => {
            const strings = JSON.parse(
                readFileSync(join(I18N_DIR, file), 'utf8')
            ).PLAYBACK_DIAGNOSTICS as Record<string, string>;
            return CARD_LABEL_KEYS.map((key) => ({
                label: strings[key].replace('{{player}}', 'ArtPlayer'),
                locale: file.replace(/\.json$/, ''),
                status: strings['EXTERNAL_STARTED'],
            }));
        });
}

/**
 * Puts each text into both cards, with a status line under the hint, and
 * reports truncated labels and any content outside the banner's visible box
 * at the top of the scroll range and, when the banner scrolls, at its end.
 */
async function measureCardTexts(
    banner: Locator,
    texts: CardText[]
): Promise<CardLayout> {
    return banner.evaluate((element, entries) => {
        const cards = Array.from(
            element.querySelectorAll<HTMLElement>(
                '.web-player-diagnostic__player-card'
            )
        );
        const labels = cards.map(
            (card) =>
                card.querySelector<HTMLElement>(
                    '.web-player-diagnostic__player-label'
                ) as HTMLElement
        );
        const originalLabels = labels.map((label) => label.textContent);
        // A clone keeps the hint's encapsulation attribute, so the status
        // class gets the panel's real status styles.
        const statuses = cards.map((card) => {
            const hint = card.querySelector(
                '.web-player-diagnostic__player-hint'
            ) as HTMLElement;
            const status = hint.cloneNode(false) as HTMLElement;
            status.className = 'web-player-diagnostic__player-status';
            hint.after(status);
            return status;
        });
        const content = element.querySelector(
            '.web-player-diagnostic__content'
        ) as HTMLElement;
        const isInside = (): boolean => {
            const box = element.getBoundingClientRect();
            const rect = content.getBoundingClientRect();
            return rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
        };
        const isLastLineVisible = (): boolean => {
            const box = element.getBoundingClientRect();
            const last = content.lastElementChild as HTMLElement;
            return last.getBoundingClientRect().bottom <= box.bottom + 0.5;
        };

        const layout = {
            clipped: [] as string[],
            scrolled: 0,
            truncated: [] as string[],
        };
        for (const entry of entries) {
            const name = `${entry.locale}: ${entry.label}`;
            labels.forEach((label) => (label.textContent = entry.label));
            statuses.forEach((status) => (status.textContent = entry.status));
            element.scrollTop = 0;
            if (labels.some((label) => label.scrollWidth > label.clientWidth)) {
                layout.truncated.push(name);
            }
            const scrolls = element.scrollHeight > element.clientHeight;
            if (!scrolls) {
                if (!isInside()) layout.clipped.push(name);
                continue;
            }
            layout.scrolled += 1;
            const topVisible =
                content.getBoundingClientRect().top >=
                element.getBoundingClientRect().top - 0.5;
            element.scrollTop = element.scrollHeight;
            if (!topVisible || !isLastLineVisible()) {
                layout.clipped.push(name);
            }
        }

        element.scrollTop = 0;
        statuses.forEach((status) => status.remove());
        labels.forEach(
            (label, index) => (label.textContent = originalLabels[index])
        );
        return layout;
    }, texts);
}

/** The EPG panel animates its height when the viewport height changes. */
async function waitForStableBox(locator: Locator): Promise<void> {
    await expect
        .poll(() =>
            locator.evaluate(async (element) => {
                const before = element.getBoundingClientRect();
                await new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                );
                const after = element.getBoundingClientRect();
                return (
                    before.width === after.width &&
                    before.height === after.height
                );
            })
        )
        .toBe(true);
}

test('@electron @m3u @playback diagnostic cards keep every locale label and status line visible in short inline players', async ({
    dataDir,
}) => {
    const server = await createMutableTextServer(
        'This fixture declares Matroska without playable media bytes.\n',
        { contentType: 'video/x-matroska', resourcePath: '/broken.mkv' }
    );
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;

    try {
        const playlist = join(dataDir, 'diagnostic-layout.m3u');
        writeFileSync(
            playlist,
            buildM3uContent([
                { name: 'Unsupported MKV', url: server.resourceUrl },
            ])
        );
        await importM3uPlaylistFromNativeDialog(app, playlist);
        await channelItemByTitle(page, 'Unsupported MKV').first().click();

        const banner = page.getByTestId('playback-diagnostic-banner');
        await expect(banner).toContainText(
            /container is likely unsupported by the browser player/i,
            { timeout: 20_000 }
        );
        await expect(banner.getByTestId('playback-fallback-mpv')).toBeVisible();
        await expect(banner.getByTestId('playback-fallback-vlc')).toBeVisible();

        const texts = cardTexts();
        expect(texts.length).toBeGreaterThan(CARD_LABEL_KEYS.length);

        // 1280x720 is the default window (a 760x404 player beside the channel
        // list); 1440 leaves the player just past the 760px breakpoint, where
        // window-sized padding used to squeeze the content until it overflowed.
        for (const viewport of [
            { width: 1280, height: 720 },
            { width: 1440, height: 720 },
        ]) {
            await page.setViewportSize(viewport);
            await waitForStableBox(banner);
            const box = await banner.boundingBox();
            expect(box?.height ?? 0).toBeLessThan(420);
            if (viewport.width === 1440) {
                expect(box?.width ?? 0).toBeGreaterThan(760);
            }

            const layout = await measureCardTexts(banner, texts);
            expect(layout.truncated, `${viewport.width}px`).toEqual([]);
            expect(layout.clipped, `${viewport.width}px`).toEqual([]);
            // Short players get the compact layout, so all of it fits.
            expect(layout.scrolled, `${viewport.width}px`).toBe(0);
        }

        // A player shorter than its content scrolls from the top: nothing is
        // pushed above the scroll origin or left below the scroll range.
        await page.setViewportSize({ width: 1440, height: 460 });
        await waitForStableBox(banner);
        expect((await banner.boundingBox())?.width ?? 0).toBeGreaterThan(760);
        const shortLayout = await measureCardTexts(banner, texts);
        expect(shortLayout.truncated).toEqual([]);
        expect(shortLayout.clipped).toEqual([]);
        expect(shortLayout.scrolled).toBe(texts.length);
    } finally {
        await closeElectronApp(app);
        await server.close();
    }
});

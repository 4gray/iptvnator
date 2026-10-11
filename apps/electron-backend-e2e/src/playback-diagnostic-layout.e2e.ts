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
 * Each locale's panel text, card labels and "player started" status are
 * written into the rendered banner instead of being reached through the
 * cards: activating an external-player card can launch a real MPV or VLC
 * installed on the machine.
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

type LocaleTexts = {
    locale: string;
    /** Every label a card can show, in this locale. */
    labels: string[];
    status: string;
    /** English panel strings paired with this locale's translation. */
    translations: [english: string, translated: string][];
};

type CardLayout = {
    /** Text nodes on the banner that have a translation key. */
    translatedNodes: number;
    /** Labels whose text is wider than their box (ellipsized or overflowing). */
    truncated: string[];
    /** Texts whose banner content leaves the visible banner box. */
    clipped: string[];
    /** Texts whose content was taller than the player, so the banner scrolled. */
    scrolled: number;
};

/** The diagnostics strings of one locale file, keyed by their dotted path. */
function readDiagnosticStrings(file: string): Map<string, string> {
    const strings = new Map<string, string>();
    const collect = (value: unknown, path: string): void => {
        if (typeof value === 'string') {
            strings.set(path, value);
        } else if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                collect(child, path ? `${path}.${key}` : key);
            }
        }
    };
    collect(
        JSON.parse(readFileSync(join(I18N_DIR, file), 'utf8'))
            .PLAYBACK_DIAGNOSTICS,
        ''
    );
    return strings;
}

function localeTexts(): LocaleTexts[] {
    const english = readDiagnosticStrings('en.json');
    return readdirSync(I18N_DIR)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
            const strings = readDiagnosticStrings(file);
            return {
                locale: file.replace(/\.json$/, ''),
                labels: CARD_LABEL_KEYS.map((key) =>
                    (strings.get(key) ?? '').replace('{{player}}', 'ArtPlayer')
                ),
                status: strings.get('EXTERNAL_STARTED') ?? '',
                translations: [...english].map(([key, value]) => [
                    value,
                    strings.get(key) ?? value,
                ]),
            };
        });
}

/**
 * Translates the banner into each locale, puts every card label of that
 * locale into both cards with a status line under the hint, and reports
 * truncated labels and any content outside the banner's visible box at the
 * top of the scroll range and, when the banner scrolls, at its end.
 */
async function measureLocales(
    banner: Locator,
    locales: LocaleTexts[]
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
        // The rest of the banner's text, rendered in English by the app.
        const panelText: { node: Text; english: string; original: string }[] =
            [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node as Text;
            const english = text.data.trim();
            if (english && !labels.some((label) => label.contains(text))) {
                panelText.push({ node: text, english, original: text.data });
            }
        }
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
            translatedNodes: Number.POSITIVE_INFINITY,
            truncated: [] as string[],
        };
        for (const entry of entries.flatMap((locale) =>
            locale.labels.map((label) => ({ ...locale, label }))
        )) {
            const translations = new Map(entry.translations);
            let translatedNodes = 0;
            for (const text of panelText) {
                const translated = translations.get(text.english);
                if (translated === undefined) continue;
                text.node.data = translated;
                translatedNodes += 1;
            }
            layout.translatedNodes = Math.min(
                layout.translatedNodes,
                translatedNodes
            );
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
        panelText.forEach((text) => (text.node.data = text.original));
        statuses.forEach((status) => status.remove());
        labels.forEach(
            (label, index) => (label.textContent = originalLabels[index])
        );
        return layout;
    }, locales);
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

        const locales = localeTexts();
        const textCount = locales.length * CARD_LABEL_KEYS.length;
        expect(locales.length).toBeGreaterThan(1);

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

            const layout = await measureLocales(banner, locales);
            // Badge, headline, description, both hints and three utilities.
            expect(layout.translatedNodes).toBeGreaterThanOrEqual(8);
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
        const shortLayout = await measureLocales(banner, locales);
        expect(shortLayout.truncated).toEqual([]);
        expect(shortLayout.clipped).toEqual([]);
        expect(shortLayout.scrolled).toBe(textCount);
    } finally {
        await closeElectronApp(app);
        await server.close();
    }
});

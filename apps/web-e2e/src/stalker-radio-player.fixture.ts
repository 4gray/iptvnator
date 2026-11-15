import type { Locator, Page } from '@playwright/test';
import { pressTab } from './e2e-helpers';
import { expect } from './fixtures';
import {
    addStalkerPortal,
    interceptStalkerRequests,
} from './stalker-portal.fixture';

/**
 * Adds the mock Stalker portal and plays a radio station whose stream is a
 * minute of synthetic PCM silence. Resolves once the audio has advanced.
 */
export async function playSyntheticStalkerRadio(page: Page): Promise<Locator> {
    await interceptStalkerRequests(page);
    const source = 'http://radio-fixture.invalid/sample.wav';
    // One minute of synthetic PCM silence, with no external stream or metadata.
    const bytes = 8000 * 60 * 2;
    const wav = Buffer.alloc(44 + bytes);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + bytes, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(bytes, 40);
    await page.route(source, (route) =>
        route.fulfill({ contentType: 'audio/wav', body: wav })
    );
    await page.route('**/localhost:3000/stalker**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('type') !== 'radio') return route.fallback();
        const action = url.searchParams.get('action');
        if (action === 'create_link') {
            await route.fulfill({ json: { payload: { js: { cmd: source } } } });
        } else if (action === 'get_ordered_list') {
            await route.fulfill({
                json: {
                    payload: {
                        js: {
                            data: [
                                {
                                    id: '9001',
                                    name: 'Synthetic Radio Alpha',
                                    o_name: 'Synthetic Radio Alpha',
                                    cmd: source,
                                    logo: '',
                                    category_id:
                                        url.searchParams.get('genre') ?? '1',
                                    tv_genre_id:
                                        url.searchParams.get('genre') ?? '1',
                                    number: '1',
                                    radio: true,
                                },
                            ],
                            total_items: 1,
                            max_page_items: 20,
                            cur_page: 1,
                            total_pages: 1,
                        },
                    },
                },
            });
        } else await route.fallback();
    });
    await addStalkerPortal(page);
    await page.getByRole('link', { name: /radio/i }).click();
    await page.getByRole('button', { name: 'News Radio', exact: true }).click();
    await page.getByText('Synthetic Radio Alpha', { exact: true }).click();
    const audio = page.locator('app-audio-player audio');
    await expect
        .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
        .toBeGreaterThan(0);
    return audio;
}

/** The computed colour a custom property resolves to on this page. */
async function computedColor(page: Page, property: string): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }, property);
}

/**
 * The radio player's play/pause control is a `mat-icon-button` drawn as the
 * 56px primary circle the fab used to draw (the fab tokens alone were about
 * 6 KB of the initial stylesheet), with the icon centred, and keyboard focus
 * draws the app ring that the fab reset with `outline: none`.
 */
export async function verifyRadioPlayControl(
    page: Page,
    browserName: string
): Promise<void> {
    const player = page.locator('app-audio-player');
    const play = player.locator('.play-btn');
    await expect(play).toBeVisible();
    await expect(play).toHaveClass(/mat-mdc-icon-button/);
    await expect(play).not.toHaveClass(/mat-mdc-fab/);

    const style = await play.evaluate((button) => {
        const icon = button.querySelector('mat-icon') as HTMLElement;
        const box = button.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        const { width, height, borderRadius, backgroundColor } =
            getComputedStyle(button);
        const centre = (rect: DOMRect) => [
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
        ];
        const [x, y] = centre(box);
        const [iconX, iconY] = centre(iconBox);
        return {
            width,
            height,
            borderRadius,
            backgroundColor,
            iconColor: getComputedStyle(icon).color,
            iconFontSize: getComputedStyle(icon).fontSize,
            iconOffset: [Math.round(iconX - x), Math.round(iconY - y)],
        };
    });
    expect(style).toEqual({
        width: '56px',
        height: '56px',
        borderRadius: '50%',
        backgroundColor: await computedColor(page, '--app-selection-color'),
        iconColor: 'rgb(255, 255, 255)',
        iconFontSize: '32px',
        iconOffset: [0, 0],
    });

    await player.locator('.skip-btn').first().focus();
    await pressTab(page, browserName);
    await expect(play).toBeFocused();
    const ring = await play.evaluate((button) => {
        const { outlineStyle, outlineWidth, outlineColor } =
            getComputedStyle(button);
        return { outlineStyle, outlineWidth, outlineColor };
    });
    expect(ring).toEqual({
        outlineStyle: 'solid',
        outlineWidth: '2px',
        outlineColor: await computedColor(page, '--app-focus-ring'),
    });
}

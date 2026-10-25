import { expect, Page, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

async function watch(page: Page, index: number, episode = false) {
    await nav(page, episode ? 'Series' : 'Movies');
    await page.locator('.poster-card').nth(index).click();
    const title = await page.locator('.detail-hero h1').innerText();
    if (episode) await page.locator('.episode').first().click();
    else await page.getByRole('button', { name: 'Watch now' }).click();
    const video = page.locator('video');
    await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
    await page.getByLabel('Playback position').fill('8');
    await expect
        .poll(() =>
            video.evaluate(
                (v: HTMLVideoElement) => !v.seeking && v.currentTime >= 8
            )
        )
        .toBe(true);
    await page.getByRole('button', { name: 'Pause', exact: false }).click();
    await page.keyboard.press('Escape');
    await nav(page, 'Home');
    await expect(page.locator('[data-focus="nav:home"]')).toBeFocused();
    return title;
}

test('home features three unfinished titles with manual wrap, remote focus, details and resume', async ({
    page,
}) => {
    test.setTimeout(90000);
    await start(page);
    await addSource(page, 'xtream', {
        username: 'marketing',
        password: 'marketing',
    });
    await nav(page, 'Home');
    await expect(page.locator('[data-focus="hero"]')).toHaveText(
        'Explore title →'
    );
    await expect(page.locator('.hero-switcher')).toHaveCount(0);
    const titles: string[] = [];
    for (let i = 0; i < 4; i++) titles.push(await watch(page, i));
    const heading = page.locator('.hero h1');
    const next = page.getByRole('button', { name: 'Next unfinished title' });
    const previous = page.getByRole('button', {
        name: 'Previous unfinished title',
    });
    await expect(heading).toHaveText(titles[3]);
    await expect(page.locator('.resume-card')).toHaveCount(4);
    await expect(page.locator('.hero-switcher')).toContainText('1 / 3');
    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(next).toBeFocused();
    for (const index of [2, 1, 3]) {
        await page.keyboard.press('Enter');
        await expect(heading).toHaveText(titles[index]);
        await expect(next).toBeFocused();
    }
    await previous.click();
    await expect(heading).toHaveText(titles[1]);
    await page.locator('[data-focus="hero"]').click();
    await expect(page.locator('.detail-hero h1')).toHaveText(titles[1]);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="hero"]')).toBeFocused();
    await expect(heading).toHaveText(titles[1]);
    await expect(page.locator('video')).not.toHaveAttribute('src');
    for (const width of [1920, 1280, 960]) {
        await page.setViewportSize({ width, height: 1080 });
        const geometry = await page.locator('.hero').evaluate((hero) => {
            const switcher = hero
                .querySelector('.hero-switcher')!
                .getBoundingClientRect();
            const rail = document
                .querySelector('.resume-card')!
                .getBoundingClientRect();
            const main = document.querySelector('main')!;
            return {
                bottom: switcher.bottom,
                rail: rail.top,
                overflow: main.scrollWidth > main.clientWidth,
            };
        });
        expect(geometry.bottom).toBeLessThan(geometry.rail);
        expect(geometry.bottom).toBeLessThan(900);
        expect(geometry.overflow).toBe(false);
    }
    await page.locator('[data-focus="hero-resume"]').click();
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
    await expect(heading).toHaveText(titles[1]);
    await page.reload();
    await expect(heading).toHaveText(titles[1]);
    await expect(page.locator('.hero-switcher')).toContainText('1 / 3');
    await expect(page.locator('.resume-card')).toHaveCount(4);
    await addSource(page, 'm3u');
    await nav(page, 'Home');
    await expect(page.locator('[data-focus="hero-resume"]')).toHaveCount(0);
    await expect(page.locator('.resume-card')).toHaveCount(0);
});

test('featured episode resumes the saved episode after relaunch', async ({
    page,
}) => {
    await start(page);
    await addSource(page, 'xtream');
    await watch(page, 0, true);
    await page.reload();
    await expect(page.locator('.hero-position')).toContainText('S1 · E1');
    await expect(page.locator('.hero-switcher')).toHaveCount(0);
    const title = await page.locator('.hero h1').innerText();
    await page.locator('[data-focus="hero-resume"]').click();
    await expect(page.locator('.player-bottom h1')).toHaveText(title);
    await expect
        .poll(() =>
            page
                .locator('video')
                .evaluate((v: HTMLVideoElement) => v.currentTime)
        )
        .toBeGreaterThan(7);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus="hero-resume"]')).toBeFocused();
});

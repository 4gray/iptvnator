import { expect, test } from './fixtures';
import { configureMockProviderBackend } from './provider-target-route';
import { playSyntheticStalkerRadio } from './stalker-radio-player.fixture';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
    await page.route('https://**', (route) => route.abort());
    await configureMockProviderBackend(page);
    await page.goto('/');
});

/**
 * The radio player's state follows its `<audio>` element, unmute always
 * sounds, and Ctrl/Alt chords are left to the app.
 */
test('@stalker @playback radio play state, unmute from zero and modifier chords', async ({
    page,
}) => {
    test.setTimeout(120_000);
    const audio = await playSyntheticStalkerRadio(page);
    const player = page.locator('app-audio-player');
    const playButton = player.locator('.play-btn');
    const muteButton = player.locator('.vol-icon');
    await expect(player.locator('.station-badge')).toHaveClass(/live/);

    // A pause the player did not ask for (media keys, the OS) shows.
    await audio.evaluate((element: HTMLAudioElement) => element.pause());
    await expect(player.locator('.station-badge')).not.toHaveClass(/live/);
    await expect(playButton).toHaveAttribute('aria-label', 'Play');
    await audio.evaluate((element: HTMLAudioElement) => element.play());
    await expect(player.locator('.station-badge')).toHaveClass(/live/);
    await expect(playButton).toHaveAttribute('aria-label', 'Pause');

    // Ctrl/Alt chords leave the volume alone.
    await player.locator('.radio-hero').click({ position: { x: 5, y: 5 } });
    const volume = await audio.evaluate((el: HTMLAudioElement) => el.volume);
    for (const chord of ['Control+m', 'Alt+ArrowDown', 'Control+ArrowUp']) {
        await page.keyboard.press(chord);
        await expect(audio).toHaveJSProperty('volume', volume);
        await expect(audio).toHaveJSProperty('muted', false);
    }

    // The volume taken all the way down: Unmute brings sound back.
    for (let step = 0; step < 21; step += 1) {
        await page.keyboard.press('ArrowDown');
    }
    await expect(audio).toHaveJSProperty('volume', 0);
    await expect(muteButton).toHaveAttribute('aria-label', 'Unmute');
    await muteButton.click();
    await expect
        .poll(() => audio.evaluate((el: HTMLAudioElement) => el.volume))
        .toBeGreaterThan(0);
    await expect(audio).toHaveJSProperty('muted', false);
    await expect(muteButton).toHaveAttribute('aria-label', 'Mute');

    // Muted, then raising the volume is heard.
    await muteButton.click();
    await expect(audio).toHaveJSProperty('volume', 0);
    await player.locator('.radio-hero').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowUp');
    await expect(audio).toHaveJSProperty('volume', 0.05);
    await expect(audio).toHaveJSProperty('muted', false);
});

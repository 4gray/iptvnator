import { expect, test } from '@playwright/test';
import { addSource, nav, start } from './helpers';

for (const mode of ['movie', 'episode', 'unknown-duration'] as const) {
    test(`resume ${mode} survives delayed metadata and an ignored seek without overwriting progress`, async ({
        page,
    }) => {
        await start(page);
        await addSource(page, 'xtream');
        await nav(page, mode === 'episode' ? 'Series' : 'Movies');
        await page.locator('.poster-card').first().click();
        if (mode === 'episode') await page.locator('.episode').first().click();
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
        await expect(page.locator('.resume-card progress')).toHaveAttribute(
            'value',
            /^(8|9)/
        );
        if (mode === 'unknown-duration') {
            await page.evaluate(
                () =>
                    new Promise<void>((resolve, reject) => {
                        const r = indexedDB.open('iptvnator-tv-user-data', 1);
                        r.onsuccess = () => {
                            const db = r.result,
                                tx = db.transaction('state', 'readwrite'),
                                store = tx.objectStore('state');
                            const read = store.get('user');
                            read.onsuccess = () => {
                                const saved = read.result;
                                saved.data.history[0].duration = 0;
                                saved.data.positions[
                                    saved.data.history[0].item.id
                                ].duration = 0;
                                store.put(saved, 'user');
                            };
                            tx.oncomplete = () => {
                                db.close();
                                resolve();
                            };
                            tx.onerror = () => {
                                db.close();
                                reject(new Error('Fixture write failed'));
                            };
                        };
                    })
            );
        }
        await page.reload();
        await expect(page.locator('.resume-card')).toBeVisible();
        // Keep native decoding; emulate the webOS readiness/seek race only.
        await video.evaluate((v: HTMLVideoElement) => {
            const time = Object.getOwnPropertyDescriptor(
                HTMLMediaElement.prototype,
                'currentTime'
            )!;
            const duration = Object.getOwnPropertyDescriptor(
                HTMLMediaElement.prototype,
                'duration'
            )!;
            let available = false,
                attempts = 0;
            Object.defineProperty(v, 'duration', {
                configurable: true,
                get: () => (available ? duration.get!.call(v) : Infinity),
            });
            Object.defineProperty(v, 'currentTime', {
                configurable: true,
                get: () => time.get!.call(v),
                set: (value: number) => {
                    attempts++;
                    v.dataset.seekAttempts = String(attempts);
                    if (attempts > 1) time.set!.call(v, value);
                },
            });
            v.addEventListener(
                'playing',
                () => {
                    setTimeout(() => {
                        available = true;
                        v.dispatchEvent(new Event('durationchange'));
                    }, 400);
                },
                { once: true }
            );
        });
        await page.locator('.resume-card').click();
        await expect
            .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
            .toBeGreaterThan(7);
        await expect(video).toHaveAttribute('data-seek-attempts', '2');
        await page.keyboard.press('Escape');
        await page.reload();
        await expect
            .poll(() =>
                page
                    .locator('.resume-card progress')
                    .evaluate((p: HTMLProgressElement) => p.value)
            )
            .toBeGreaterThan(7);
    });
}

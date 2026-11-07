/** Requires a debug APK and the mock provider: run-dev.sh, then
 * ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-background-media.mjs emulator-5554
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _android } from '@playwright/test';

const serial = process.argv[2];
assert.ok(serial?.startsWith('emulator-'), 'An explicit emulator serial is required.');
assert.ok(process.env.ANDROID_HOME, 'Set ANDROID_HOME to the Android SDK.');
const adb = (...args) => execFileSync(join(process.env.ANDROID_HOME, 'platform-tools/adb'), ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
let device;
adb('reverse', 'tcp:43331', 'tcp:43331');
try {
    adb('shell', 'am', 'start', '-n', 'org.tvshell.iptvnator/.ui.MainActivity');
    device = (await _android.devices({ omitDriverInstall: true })).find((value) => value.serial() === serial);
    assert.ok(device, 'Emulator was not found.');
    const page = await (await device.webView({ pkg: 'org.tvshell.iptvnator' })).page();
    await page.waitForLoadState('domcontentloaded');
    const trailerUrl = 'https://www.youtube-nocookie.com/embed/synthetic-trailer';
    await page.route(trailerUrl, (route) => route.fulfill({
        contentType: 'text/html',
        body: '<video muted loop></video>',
    }));
    const trailer = page.locator('app-trailer-dialog');
    const trailerClip = readFileSync(new URL('../devserver/clip.webm', import.meta.url)).toString('base64');
    async function playTrailer() {
        await page.evaluate((url) => {
            const dialog = document.createElement('app-trailer-dialog');
            dialog.innerHTML = '<iframe allow="autoplay"></iframe><button data-test-id="trailer-dialog-close">Close</button>';
            dialog.querySelector('button').onclick = () => dialog.remove();
            dialog.querySelector('iframe').src = url;
            document.body.append(dialog);
        }, trailerUrl);
        const video = trailer.frameLocator('iframe').locator('video');
        await video.evaluate(async (media, clip) => {
            media.src = `data:video/webm;base64,${clip}`;
            await media.play();
        }, trailerClip);
        assert.equal(await video.evaluate((media) => media.paused), false);
    }
    await page.evaluate(() => {
        document.body.innerHTML = '<video id="synthetic-video" loop muted></video><audio id="synthetic-audio" loop></audio>';
        document.querySelector('video').src = 'http://127.0.0.1:43331/movie/synthetic-account/synthetic-secret/clip.webm';
        const pcm = new ArrayBuffer(44 + 160000);
        const header = new DataView(pcm);
        const text = (offset, value) => Array.from(value).forEach((char, index) => header.setUint8(offset + index, char.charCodeAt(0)));
        text(0, 'RIFF'); header.setUint32(4, pcm.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
        header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
        header.setUint32(24, 8000, true); header.setUint32(28, 16000, true);
        header.setUint16(32, 2, true); header.setUint16(34, 16, true); text(36, 'data'); header.setUint32(40, 160000, true);
        document.querySelector('audio').src = URL.createObjectURL(new Blob([pcm], { type: 'audio/wav' }));
        window.TvShell.postMessage('["onReady"]');
    });
    const states = () => page.evaluate(() => Array.from(document.querySelectorAll('video,audio')).map((media) => media.paused));
    const start = () => page.evaluate(() => Promise.all(Array.from(document.querySelectorAll('video,audio')).map((media) => media.play())));
    async function waitPaused() {
        for (let attempt = 0; attempt < 30; attempt++) {
            const state = await states();
            if (state.length === 2 && state.every(Boolean)) return;
            await delay(100);
        }
        assert.fail('Background HTML media was not paused.');
    }
    await start();
    assert.deepEqual(await states(), [false, false]);
    await playTrailer();
    adb('shell', 'input', 'keyevent', '3');
    await waitPaused();
    await trailer.waitFor({ state: 'detached', timeout: 3000 });
    console.log('PASS Home pauses native video and audio and closes the playing trailer');
    // Simulate a late async player retry while the activity is hidden.
    await page.evaluate(() => document.querySelectorAll('video,audio').forEach((media) => { media.play().catch(() => undefined); }));
    await waitPaused();
    console.log('PASS late background playback is stopped');
    adb('shell', 'am', 'start', '-n', 'org.tvshell.iptvnator/.ui.MainActivity');
    await delay(300);
    assert.deepEqual(await states(), [true, true]);
    assert.equal(await trailer.count(), 0);
    await start();
    assert.deepEqual(await states(), [false, false]);
    console.log('PASS foreground permits explicit playback without autoplay on return');
    await playTrailer();
    await page.evaluate(() => window.TvShell.postMessage('["openSettings"]'));
    await waitPaused();
    await trailer.waitFor({ state: 'detached', timeout: 3000 });
    adb('shell', 'input', 'keyevent', '4');
    await delay(300);
    assert.deepEqual(await states(), [true, true]);
    assert.equal(await trailer.count(), 0);
    console.log('PASS native settings pauses media and closes the playing trailer');
} finally {
    await device?.close();
    adb('reverse', '--remove', 'tcp:43331');
}

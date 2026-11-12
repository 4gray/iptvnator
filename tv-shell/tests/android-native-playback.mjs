/** Run against a debug APK on a test emulator. Requires ffmpeg with libx264.
 * ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-native-playback.mjs emulator-5554
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _android, expect } from '@playwright/test';

const serial = process.argv[2];
assert.ok(serial?.startsWith('emulator-') && process.env.ANDROID_HOME,
    'Set ANDROID_HOME and pass an emulator serial.');
const app = 'org.tvshell.iptvnator';
const adb = (...args) => execFileSync(join(process.env.ANDROID_HOME, 'platform-tools/adb'),
    ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
const topActivity = () => adb('shell', 'dumpsys', 'activity', 'activities')
    .split('\n').find((line) => line.includes('topResumedActivity')) || '';

// Dismiss Android's one-time immersive mode tutorial on the test emulator.
const immersive = adb('shell', 'settings', 'get', 'secure', 'immersive_mode_confirmations').trim();
adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed');

const fixtures = mkdtempSync(join(tmpdir(), 'iptvnator-native-test-'));
const servers = [];
let device;
let settingsOpen = false;
try {
    const mp4 = join(fixtures, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', '20', '-c:v', 'libx264', '-g', '25', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-movflags', 'faststart', mp4]);
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4, '-c', 'copy',
        '-hls_time', '2', '-hls_list_size', '0', join(fixtures, 'synthetic.m3u8')]);
    const mkv = join(fixtures, 'synthetic-ac3.mkv');
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4,
        '-c:v', 'copy', '-c:a', 'ac3', '-ac', '6', mkv]);
    const clip = readFileSync(mp4);
    const ac3Clip = readFileSync(mkv);
    const seen = { origin: [], target: [], segments: 0 };
    const respond = (req, res, data, mime) => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        res.writeHead(range ? 206 : 200, {
            'Content-Type': mime,
            'Content-Length': end - start + 1,
            'Access-Control-Allow-Origin': '*',
            'Accept-Ranges': 'bytes',
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
        });
        res.end(data.subarray(start, end + 1));
    };
    async function serve(handler) {
        const server = createServer(handler);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        servers.push({ server, port });
        adb('reverse', `tcp:${port}`, `tcp:${port}`);
        return `http://127.0.0.1:${port}`;
    }
    const target = await serve((req, res) => {
        seen.target.push(req.headers);
        respond(req, res, clip, 'video/mp4');
    });
    const origin = await serve((req, res) => {
        seen.origin.push(req.headers);
        if (req.url === '/synthetic.mp4') {
            res.writeHead(302, { Location: target + '/redirected.mp4', 'Access-Control-Allow-Origin': '*' });
            res.end();
        } else if (req.url === '/synthetic-ac3.mkv') {
            respond(req, res, ac3Clip, 'video/x-matroska');
        } else if (/^\/synthetic\d+\.ts$/.test(req.url)) {
            seen.segments++;
            const segment = readFileSync(join(fixtures, req.url.slice(1)));
            // No CORS on segments: only the native engine can fetch these for playback.
            res.writeHead(200, { 'Content-Type': 'video/mp2t' });
            res.end(segment);
        } else if (req.url === '/synthetic.m3u8') {
            const manifest = readFileSync(join(fixtures, 'synthetic.m3u8'));
            // No CORS on the manifest either, so WebView cannot reach the segments.
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
            res.end(manifest);
        } else {
            res.writeHead(404).end();
        }
    });

    adb('shell', 'am', 'start', '-n', `${app}/.ui.MainActivity`);
    device = (await _android.devices({ omitDriverInstall: true })).find((item) => item.serial() === serial);
    assert.ok(device, 'Emulator was not found.');
    const page = await (await device.webView({ pkg: app })).page();
    page.setDefaultTimeout(20000);
    await page.waitForFunction(() => window.__tvShell && !document.getElementById('initial-splash'));
    async function setExperiment(enabled) {
        await page.evaluate(() => window.TvShell.postMessage('["openSettings"]'));
        settingsOpen = true;
        await expect.poll(topActivity).toContain('.ui.SettingsActivity');
        const layout = '/sdcard/iptvnator-native-playback-test.xml';
        adb('shell', 'uiautomator', 'dump', '--compressed', layout);
        const checkbox = adb('shell', 'cat', layout).match(/<node [^>]*resource-id="org\.tvshell\.iptvnator:id\/native_playback"[^>]*>/)?.[0];
        adb('shell', 'rm', layout);
        assert.ok(checkbox, 'The native playback setting must be visible.');
        if (checkbox.includes('checked="true"') !== enabled) {
            const bounds = checkbox.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
            const [left, top, right, bottom] = bounds;
            adb('shell', 'input', 'tap', String((left + right) / 2), String((top + bottom) / 2));
        }
        adb('shell', 'input', 'keyevent', '4');
        settingsOpen = false;
        await page.waitForFunction((value) => Boolean(window.iptvnatorAndroidPlaybackLabels) === value, enabled);
    }
    await setExperiment(false);
    const playlist = [
        '#EXTM3U',
        '#EXTINF:-1 group-title="Movies",Synthetic Feature',
        '#EXTVLCOPT:http-user-agent=Synthetic-Playback',
        origin + '/synthetic.mp4',
        '#EXTINF:-1 group-title="Live",Synthetic Live',
        origin + '/synthetic.m3u8',
        '#EXTINF:-1 group-title="Movies",Synthetic AC-3',
        origin + '/synthetic-ac3.mkv',
    ].join('\n');
    await page.goto(new URL('/', page.url()).href);
    await page.getByRole('button', { name: 'Add playlist' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Raw m3u text/i }).click();
    await dialog.getByLabel('Insert m3u(8) playlist as text').fill(playlist);
    await Promise.all([
        page.waitForURL(/\/workspace\/playlists\/.+\/all$/),
        dialog.getByRole('button', { name: 'Add playlist', exact: true }).click(),
    ]);
    const entry = (name) => page.locator('[data-test-id="channel-item"]').filter({ hasText: name });
    await entry('Synthetic Feature').click();
    const stage = page.locator('app-web-player-view');
    const action = stage.getByRole('button', { name: 'Try built-in player' });
    const video = stage.locator('video');
    await expect(video).toBeAttached();
    await expect(action).toHaveCount(0);
    await setExperiment(true);
    await expect(action).toBeVisible();
    await page.evaluate(() => {
        window.addEventListener('iptvnator:android-playback-result', (event) => {
            window.__nativeResult = event.detail.result;
        });
    });
    const channelRoute = page.url();
    const waitNative = () => expect.poll(topActivity).toContain('.ui.NativePlayerActivity');
    const pid = adb('shell', 'pidof', app).trim();
    const waitAudio = () => expect.poll(() => adb('shell', 'dumpsys', 'audio').split('\n').some(
        (line) => line.includes('AudioPlaybackConfiguration') &&
            line.includes('type:android.media.AudioTrack') && line.includes(`/${pid} state:started`),
    ), { timeout: 10000 }).toBe(true);
    async function back() {
        adb('shell', 'input', 'keyevent', '4');
        await expect.poll(topActivity).toContain('.ui.MainActivity');
    }
    const redirectedBefore = seen.target.length;
    await action.focus();
    adb('shell', 'input', 'keyevent', '66');
    await waitNative();
    await expect(video).toHaveCount(0);
    await expect.poll(() => seen.target.length).toBeGreaterThan(redirectedBefore);
    await waitAudio();
    await delay(4200);
    adb('shell', 'input', 'keyevent', '3');
    await expect.poll(() => {
        const top = topActivity();
        return Boolean(top) && !top.includes(app);
    }).toBe(true);
    adb('shell', 'am', 'start', '-a', 'android.intent.action.MAIN',
        '-c', 'android.intent.category.LAUNCHER', '-n', `${app}/.ui.MainActivity`);
    await expect.poll(topActivity).toContain('.ui.MainActivity');
    assert.equal(page.url(), channelRoute);
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    const result = await page.evaluate(() => window.__nativeResult);
    assert.ok(result?.playedMs >= 2000 && result.durationMs > 15000 && result.positionMs >= 2000,
        `Home and launcher return must preserve the native VOD position. Got ${JSON.stringify(result)}`);
    assert.ok(seen.origin.some((headers) => headers['user-agent'] === 'Synthetic-Playback'),
        'The resolved provider user agent must reach the stream origin.');
    assert.ok(seen.target.slice(redirectedBefore).every((headers) => headers['user-agent'] !== 'Synthetic-Playback'),
        'A cross-origin redirect must not receive the provider user agent.');
    await stage.getByRole('button', { name: 'Return to web player' }).click();
    await expect.poll(() => video.evaluate((media) => media.currentTime)).toBeGreaterThanOrEqual(result.positionMs / 1000 - 1);

    await page.evaluate(() => { delete window.__nativeResult; });
    await entry('Synthetic Live').click();
    await expect(action).toBeVisible();
    await action.click();
    await waitNative();
    await expect.poll(() => seen.segments).toBeGreaterThan(0);
    await delay(3200);
    await back();
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    assert.ok((await page.evaluate(() => window.__nativeResult))?.playedMs >= 2000,
        'Native HLS must play without browser CORS headers.');
    await entry('Synthetic AC-3').click();
    await expect(action).toBeVisible();
    await action.click();
    await waitNative();
    await expect(video).toHaveCount(0);
    await waitAudio();
    await back();
    await setExperiment(false);
    await expect(action).toHaveCount(0);
    console.log('PASS Android Media3 opt-in, VOD resume after Home, redirect header scope, HLS Back and AC-3 audio output');
} finally {
    if (settingsOpen || topActivity().includes('.ui.NativePlayerActivity')) adb('shell', 'input', 'keyevent', '4');
    await device?.close();
    for (const { server, port } of servers) {
        adb('reverse', '--remove', `tcp:${port}`);
        server.closeAllConnections();
        server.close();
    }
    rmSync(fixtures, { recursive: true, force: true });
    if (!immersive || immersive === 'null') {
        adb('shell', 'settings', 'delete', 'secure', 'immersive_mode_confirmations');
    }
}

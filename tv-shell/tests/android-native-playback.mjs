/** Run against a debug APK on a test emulator. Requires ffmpeg with libx264.
 * ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-native-playback.mjs emulator-5554
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const dumpLayout = () => adb('exec-out', 'uiautomator', 'dump', '--compressed', '/dev/tty');
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
    const subtitles = join(fixtures, 'synthetic.srt');
    writeFileSync(subtitles, '1\n00:00:00,000 --> 00:00:20,000\nSynthetic subtitle\n');
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4, '-i', subtitles,
        '-c:v', 'copy', '-c:a', 'ac3', '-ac', '6', '-metadata:s:s:0', 'language=eng',
        '-disposition:s:0', '0', mkv]);
    const unsupported = join(fixtures, 'synthetic-unsupported-video.mkv');
    // Theora has no Android video decoder. Leave an ordinary AAC track to
    // distinguish unsupported video from a source that is meant to be audio-only.
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4,
        '-t', '4', '-c:v', 'libtheora', '-c:a', 'copy', unsupported]);
    const unsupportedAudio = join(fixtures, 'synthetic-unsupported-audio.mkv');
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4,
        '-t', '4', '-c:v', 'copy', '-c:a', 'dca', '-strict', 'experimental', unsupportedAudio]);
    const audioOnly = join(fixtures, 'synthetic-audio.m4a');
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4,
        '-vn', '-c:a', 'copy', audioOnly]);
    const clip = readFileSync(mp4);
    const ac3Clip = readFileSync(mkv);
    const chunkedClip = Buffer.concat(
        Array.from({ length: 10 }, (_, index) =>
            readFileSync(join(fixtures, `synthetic${index}.ts`))
        )
    );
    const seen = { origin: [], target: [], segments: 0, failedStreamRequests: 0, sessionCookie: '' };
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
        } else if (req.url === '/synthetic-session.mp4') {
            res.writeHead(302, {
                Location: '/synthetic-session-video.mp4',
                'Set-Cookie': 'synthetic_session=fresh; Path=/',
            }).end();
        } else if (req.url === '/synthetic-session-video.mp4') {
            seen.sessionCookie = req.headers.cookie ?? '';
            if (seen.sessionCookie.includes('synthetic_session=fresh')) {
                res.writeHead(302, { Location: target + '/redirected.mp4' }).end();
            } else {
                res.writeHead(403).end();
            }
        } else if (req.url === '/synthetic-chunked.ts') {
            res.writeHead(200, { 'Content-Type': 'video/mp2t' });
            res.flushHeaders();
            const chunkSize = Math.ceil(chunkedClip.length / 80);
            let offset = 0;
            const timer = setInterval(() => {
                res.write(chunkedClip.subarray(offset, offset + chunkSize));
                offset += chunkSize;
                if (offset >= chunkedClip.length) res.end();
            }, 250);
            res.on('close', () => clearInterval(timer));
        } else if (req.url === '/synthetic-unsupported-video.mkv') {
            respond(req, res, readFileSync(unsupported), 'video/x-matroska');
        } else if (req.url === '/synthetic-unsupported-audio.mkv') {
            respond(req, res, readFileSync(unsupportedAudio), 'video/x-matroska');
        } else if (req.url === '/synthetic-audio.m4a') {
            respond(req, res, readFileSync(audioOnly), 'audio/mp4');
        } else if (req.url === '/synthetic-unplayable.mp4') {
            seen.failedStreamRequests++;
            respond(req, res, Buffer.from('Synthetic unsupported media'), 'video/mp4');
        } else if (req.url === '/synthetic-ac3.mkv') {
            respond(req, res, ac3Clip, 'video/x-matroska');
        } else if (/^\/synthetic\d+\.ts$/.test(req.url)) {
            seen.segments++;
            const segment = readFileSync(join(fixtures, req.url.slice(1)));
            // No CORS on segments: only the native engine can fetch these for playback.
            res.writeHead(200, { 'Content-Type': 'video/mp2t' });
            res.end(segment);
        } else if (req.url === '/synthetic-live') {
            res.writeHead(302, { Location: '/synthetic-manifest' }).end();
        } else if (req.url === '/synthetic.ism/Manifest?format=hls') {
            const manifest = readFileSync(join(fixtures, 'synthetic.m3u8'), 'utf8')
                .replace(/^synthetic/gm, '/synthetic');
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
            res.end(manifest);
        } else if (req.url === '/synthetic-manifest') {
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
    let page = await (await device.webView({ pkg: app })).page();
    page.setDefaultTimeout(20000);
    await page.waitForFunction(() => window.__tvShell && !document.getElementById('initial-splash'));
    async function setExperiment(enabled) {
        await page.evaluate(() => window.TvShell.postMessage('["openSettings"]'));
        settingsOpen = true;
        await expect.poll(topActivity).toContain('.ui.SettingsActivity');
        let checkbox;
        await expect.poll(() => {
            checkbox = dumpLayout().match(/<node [^>]*resource-id="org\.tvshell\.iptvnator:id\/native_playback"[^>]*>/)?.[0];
            return checkbox;
        }, { timeout: 30000, message: 'The native playback setting must be visible.' }).toBeDefined();
        if (checkbox.includes('checked="true"') !== enabled) {
            const bounds = checkbox.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
            const [left, top, right, bottom] = bounds;
            adb('shell', 'input', 'tap', String((left + right) / 2), String((top + bottom) / 2));
        }
        adb('shell', 'input', 'keyevent', '4');
        settingsOpen = false;
        await page.waitForFunction((value) => window.iptvnatorAndroidPlaybackEnabled === value, enabled);
    }
    await setExperiment(false);
    await page.goto(new URL('/workspace/settings/playback', page.url()).href);
    const captions = page.getByRole('switch', { name: 'Show subtitles' });
    await expect(captions).toBeVisible({ timeout: 20000 });
    if (!(await captions.isChecked())) {
        await captions.click();
        const save = page.getByRole('button', { name: 'Save changes' });
        await save.click();
        await expect(save).toBeHidden();
    }
    const playlist = [
        '#EXTM3U',
        '#EXTINF:-1 group-title="Movies",Synthetic Feature',
        '#EXTVLCOPT:http-user-agent=Synthetic-Playback',
        origin + '/synthetic.mp4',
        '#EXTINF:-1 group-title="Live",Synthetic Live',
        origin + '/synthetic-live',
        '#EXTINF:-1 group-title="Live",Synthetic Manifest HLS',
        origin + '/synthetic.ism/Manifest?format=hls',
        '#EXTINF:-1 group-title="Movies",Synthetic AC-3',
        origin + '/synthetic-ac3.mkv',
        '#EXTINF:-1 group-title="Movies",Synthetic Unplayable',
        origin + '/synthetic-unplayable.mp4',
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
    await expect(entry('Synthetic Feature')).toBeVisible({ timeout: 60000 });
    await entry('Synthetic Feature').click();
    const stage = page.locator('app-web-player-view');
    const action = stage.getByRole('button', { name: 'Try built-in player' });
    const video = stage.locator('video');
    await expect(video).toBeAttached();
    await expect(action).toHaveCount(0);
    await setExperiment(true);
    await expect(action).toBeVisible();
    for (const request of [
        { url: origin + '/synthetic.ism/Manifest' },
        { url: origin + '/synthetic.mpd', hls: true },
        { url: origin + '/synthetic.mpd/' },
    ]) {
        const rejected = await page.evaluate((request) => new Promise((resolve) => {
            const id = crypto.randomUUID();
            window.addEventListener('iptvnator:android-playback-result', (event) => {
                resolve(event.detail.id === id && event.detail.result === null);
            }, { once: true });
            window.TvShell.postMessage(JSON.stringify(['playNative', id, request]));
        }), request);
        assert.equal(rejected, true, 'The bridge must reject Smooth Streaming and DASH.');
    }
    await page.evaluate(() => {
        let foreground = true;
        const setForeground = window.__tvShell.setForeground.bind(window.__tvShell);
        window.__tvShell.setForeground = (on) => {
            foreground = on;
            setForeground(on);
        };
        window.addEventListener('iptvnator:android-playback-result', (event) => {
            window.__nativeResult = event.detail.result;
            if (event.detail.result?.ended) window.__nativeCompletedInForeground = foreground;
        });
    });
    const channelRoute = page.url();
    const waitNative = () => expect.poll(topActivity).toContain('.ui.NativePlayerActivity');
    const pid = adb('shell', 'pidof', app).trim();
    const audioTrack = () => adb('shell', 'dumpsys', 'audio').split('\n').find(
        (line) => line.includes('AudioPlaybackConfiguration') &&
            line.includes('type:android.media.AudioTrack') && line.includes(`/${pid} state:started`),
    ) ?? '';
    const waitAudio = () => expect.poll(audioTrack, { timeout: 10000 }).toContain('AudioTrack');
    async function back() {
        adb('shell', 'input', 'keyevent', '4');
        await expect.poll(topActivity).toContain('.ui.MainActivity');
    }
    const redirectedBefore = seen.target.length;
    await video.evaluate((element) => {
        element.volume = 0.25;
        element.muted = true;
    });
    // Leave touch mode before assigning focus for the remote activation.
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_RIGHT');
    await action.focus();
    await expect(action).toBeFocused();
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_CENTER');
    await waitNative();
    await expect(video).toHaveCount(0);
    await expect.poll(() => seen.target.length).toBeGreaterThan(redirectedBefore);
    await expect.poll(audioTrack, { timeout: 10000 }).toMatch(/mutedState:[^ ]*clientVolume/);
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_UP');
    const muteButton = /<node [^>]*resource-id="org\.tvshell\.iptvnator:id\/native_mute"[^>]*>/;
    const unmute = dumpLayout().match(muteButton)?.[0];
    assert.ok(unmute?.includes('content-desc="Unmute"'), 'Muted native playback must offer Unmute.');
    const [left, top, right, bottom] = unmute.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
    adb('shell', 'input', 'tap', String((left + right) / 2), String((top + bottom) / 2));
    await expect.poll(() => {
        const track = audioTrack();
        return track.includes('AudioTrack') && !/mutedState:[^ ]*clientVolume/.test(track);
    }).toBe(true);
    await delay(2900);
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
    assert.equal(result.ended, false, 'Leaving via Home is a playback checkpoint.');

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url }]));
    }, origin + '/synthetic-ac3.mkv');
    await waitNative();
    await waitAudio();
    await delay(3000);
    adb('shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH');
    await expect.poll(topActivity).not.toContain(app);
    adb('shell', 'am', 'start', '-a', 'android.intent.action.MAIN',
        '-c', 'android.intent.category.LAUNCHER', '-n', `${app}/.ui.MainActivity`);
    await expect.poll(topActivity).toContain('.ui.MainActivity');
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    const recentsResult = await page.evaluate(() => window.__nativeResult);
    assert.ok(recentsResult?.positionMs >= 1000, 'Recents and launcher return must preserve the VOD position.');
    assert.ok(!adb('shell', 'cmd', 'media_session', 'list-sessions').includes(app),
        'Leaving for Recents must release native media controls.');

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url }]));
    }, origin + '/synthetic-ac3.mkv');
    await waitNative();
    await waitAudio();
    adb('shell', 'cmd', 'media_session', 'dispatch', 'stop');
    await expect.poll(topActivity).toContain('.ui.MainActivity');
    await page.waitForFunction(() => window.__nativeResult?.started === true);
    assert.equal(await page.evaluate(() => window.__nativeResult.ended), false);
    assert.ok(seen.origin.some((headers) => headers['user-agent'] === 'Synthetic-Playback'),
        'The resolved provider user agent must reach the stream origin.');
    assert.ok(seen.target.slice(redirectedBefore).some((headers) => /^okhttp\//i.test(headers['user-agent'] ?? '')),
        'The native redirect must retain the default OkHttp user agent.');
    assert.ok(seen.target.slice(redirectedBefore).every((headers) => headers['user-agent'] !== 'Synthetic-Playback'),
        'A cross-origin redirect must not receive the provider user agent.');
    for (let attempt = 0; attempt < 3; attempt++) {
        await expect(action).toBeEnabled();
        await action.click();
        await waitNative();
        await back();
    }
    await expect(action).toBeEnabled();
    await stage.getByRole('button', { name: 'Return to web player' }).click();
    await expect.poll(() => video.evaluate((media) => media.currentTime)).toBeGreaterThanOrEqual(result.positionMs / 1000 - 1);
    await expect.poll(() => video.evaluate((media) => media.muted ? 0 : media.volume)).toBe(0);

    await page.evaluate(() => { delete window.__nativeResult; });
    await entry('Synthetic Manifest HLS').click();
    await expect(action).toBeVisible();
    await action.click();
    await waitNative();
    await waitAudio();
    await back();

    await page.waitForFunction(() => window.__nativeResult !== undefined);
    await page.evaluate(() => { delete window.__nativeResult; });
    const segmentsBeforeLive = seen.segments;
    await entry('Synthetic Live').click();
    await expect(action).toBeVisible();
    await action.click();
    await waitNative();
    await expect.poll(() => seen.segments).toBeGreaterThan(segmentsBeforeLive);
    await waitAudio();
    await delay(3200);
    await back();
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    assert.ok((await page.evaluate(() => window.__nativeResult))?.playedMs >= 2000,
        'Native HLS must play without browser CORS headers.');
    assert.equal(await page.evaluate(() => window.__nativeResult.ended), false, 'Back is a playback checkpoint.');
    assert.ok(!adb('shell', 'cmd', 'media_session', 'list-sessions').includes(app),
        'The exited player must release media controls before the next stream opens.');
    await page.evaluate(() => { delete window.__nativeResult; });
    await entry('Synthetic AC-3').click();
    await expect(action).toBeVisible();
    await action.click();
    await waitNative();
    await expect(video).toHaveCount(0);
    await waitAudio();
    const subtitleButton = /<node [^>]*resource-id="org\.tvshell\.iptvnator:id\/exo_subtitle"[^>]*>/;
    const captionsState = () => {
        const button = dumpLayout().match(subtitleButton)?.[0];
        // Direct bridge launches have no focused control for a remote click.
        if (!button) adb('shell', 'input', 'tap', '120', '120');
        return button?.match(/content-desc="([^"]*)"/)?.[1] ?? '';
    };
    await expect.poll(captionsState, { timeout: 8000 }).toBe('Disable subtitles');
    adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
    await expect.poll(audioTrack).toBe('');
    function tapNode(node) {
        const [, left, top, right, bottom] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        adb('shell', 'input', 'tap', String((+left + +right) / 2), String((+top + +bottom) / 2));
    }
    await expect.poll(() => {
        const layout = dumpLayout();
        const none = layout.match(/<node [^>]*text="None"[^>]*>/)?.[0];
        if (none) {
            tapNode(none);
            return true;
        }
        const button = layout.match(subtitleButton)?.[0];
        if (button) tapNode(button);
        else adb('shell', 'input', 'tap', '120', '120');
        return false;
    }, { message: 'The Android subtitle menu opens while paused', timeout: 15000 }).toBe(true);
    await expect.poll(captionsState).toBe('Enable subtitles');
    adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY');
    await waitAudio();
    await page.waitForFunction(() => window.__nativeResult?.ended === true, undefined, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__nativeCompletedInForeground), true,
        'Natural completion must reach autoplay after the foreground guard clears.');
    await expect.poll(topActivity).toContain('.ui.MainActivity');
    await setExperiment(false);
    await expect(action).toHaveCount(0);
    await setExperiment(true);
    const systemCaptionSettings = ['accessibility_captioning_enabled', 'accessibility_captioning_locale'];
    const previousCaptionSettings = systemCaptionSettings.map((key) =>
        adb('shell', 'settings', 'get', 'secure', key).trim()
    );
    try {
        adb('shell', 'settings', 'put', 'secure', systemCaptionSettings[0], '1');
        adb('shell', 'settings', 'put', 'secure', systemCaptionSettings[1], 'en_US');
        await page.evaluate((url) => {
            window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, captions: false }]));
        }, origin + '/synthetic-ac3.mkv');
        await waitNative();
        await waitAudio();
        await expect.poll(captionsState, { timeout: 8000 }).toBe('Enable subtitles');
        await back();
    } finally {
        for (const [index, key] of systemCaptionSettings.entries()) {
            const value = previousCaptionSettings[index];
            if (value === 'null') adb('shell', 'settings', 'delete', 'secure', key);
            else adb('shell', 'settings', 'put', 'secure', key, value);
        }
    }
    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url }]));
    }, origin + '/synthetic-chunked.ts');
    await waitNative();
    await waitAudio();
    await delay(2500);
    await back();
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    const unknownDuration = await page.evaluate(() => window.__nativeResult);
    assert.equal(unknownDuration.durationMs, 0);
    assert.ok(unknownDuration.positionMs > 0, 'Preserve the playhead even when duration is unknown.');

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, startTime: 10 }]));
    }, origin + '/synthetic-chunked.ts');
    await waitNative();
    await waitAudio();
    await delay(1000);
    await back();
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    const unseekableResume = await page.evaluate(() => window.__nativeResult);
    assert.equal(unseekableResume.positionMs, 0, 'Keep the existing resume point when the source cannot seek.');
    assert.equal(unseekableResume.durationMs, 0);
    assert.ok(unseekableResume.playedMs > 0, 'Report playback time even when the existing resume point is preserved.');

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, startTime: 10 }]));
    }, origin + '/synthetic-chunked.ts');
    await waitNative();
    await page.waitForFunction(() => window.__nativeResult?.ended === true, undefined, { timeout: 40000 });
    const completed = await page.evaluate(() => window.__nativeResult);
    assert.equal(completed.started, true);
    assert.ok(completed.durationMs > 0);
    assert.equal(completed.positionMs, completed.durationMs, 'Natural EOF completes the episode even when the source cannot seek.');

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, hls: true, live: true }]));
    }, origin + '/synthetic-live');
    await waitNative();
    await page.waitForFunction(() => window.__nativeResult?.ended === true, undefined, { timeout: 40000 });
    const endedLive = await page.evaluate(() => window.__nativeResult);
    assert.equal(endedLive.positionMs, 0);
    assert.equal(endedLive.durationMs, 0);

    const sessionRedirectBefore = seen.target.length;
    await page.evaluate((url) => {
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), {
            url, headers: { Cookie: 'synthetic_session=old; synthetic_other=initial' },
        }]));
    }, origin + '/synthetic-session.mp4');
    await waitNative();
    await waitAudio();
    assert.deepEqual(seen.sessionCookie.split('; ').sort(), ['synthetic_other=initial', 'synthetic_session=fresh']);
    assert.ok(seen.target.length > sessionRedirectBefore);
    assert.ok(seen.target.slice(sessionRedirectBefore).every((headers) => !headers.cookie),
        'Provider and session cookies stay on the original origin.');
    await back();

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, startTime: 12 }]));
    }, origin + '/synthetic-missing.mp4');
    await waitNative();
    await back();
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    assert.equal((await page.evaluate(() => window.__nativeResult)).positionMs, 0,
        'Leaving before the VOD loads must not save the requested offset.');

    await page.evaluate((url) => {
        delete window.__nativeResult;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, startTime: 8 }]));
    }, origin + '/synthetic-ac3.mkv');
    await waitNative();
    await waitAudio();
    await back();
    await page.waitForFunction(() => window.__nativeResult !== undefined);
    assert.ok((await page.evaluate(() => window.__nativeResult)).positionMs >= 8000,
        'Resume a VOD from a valid saved offset.');

    for (const [path, failed] of [['/synthetic-unsupported-video.mkv', true], ['/synthetic-unsupported-audio.mkv', true], ['/synthetic-audio.m4a', false]]) {
        await page.evaluate((url) => {
            delete window.__nativeResult;
            window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url }]));
        }, origin + path);
        await waitNative();
        if (failed) {
            await expect.poll(() => dumpLayout().includes('The built-in player could not play this stream')).toBe(true);
        } else {
            await waitAudio();
        }
        await back();
        await page.waitForFunction(() => window.__nativeResult !== undefined);
        assert.equal(await page.evaluate(() => window.__nativeResult.failed), failed);
    }

    await page.evaluate((url) => {
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url, live: true, hls: true }]));
    }, origin + '/synthetic-live');
    await waitNative();
    await waitAudio();
    adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
    await expect.poll(audioTrack).toBe('');
    const timeBar = /<node [^>]*resource-id="org\.tvshell\.iptvnator:id\/exo_progress"[^>]*>/;
    await expect.poll(() => {
        const bar = dumpLayout().match(timeBar)?.[0];
        if (!bar) adb('shell', 'input', 'tap', '120', '120');
        return Boolean(bar && bar.includes('enabled="false"'));
    }).toBe(true);
    await back();

    const playlistId = 'synthetic-reload-' + randomUUID();
    const launchRotationFixture = (sourceId, startTime) => page.evaluate(({ url, playlistId, startTime }) => {
        const id = crypto.randomUUID();
        const viewport = document.querySelector('meta[name=viewport]').content;
        window.addEventListener('iptvnator:android-playback-result', (event) => {
            if (event.detail.id === id && event.detail.result?.started) {
                window.__rotationResult = document.querySelector('meta[name=viewport]').content !== viewport;
            }
        });
        window.TvShell.postMessage(JSON.stringify(['playNative', id, {
            url,
            startTime,
            captions: true,
            checkpoint: {
                profile: 'iptvnator',
                playlistId,
                contentType: 'episode',
                contentXtreamId: 17,
                seriesXtreamId: 3,
            },
        }]));
    }, { url: origin + '/synthetic-ac3.mkv', playlistId: sourceId, startTime });
    await launchRotationFixture('synthetic-rotation-' + randomUUID(), 25);
    await waitNative();
    await waitAudio();
    const lastNativeCreate = () => adb('logcat', '-b', 'events', '-d', '-v', 'epoch', '-s', 'wm_on_create_called')
        .split('\n').findLast((line) => line.includes(app + '.ui.NativePlayerActivity')) ?? '';
    const oldRotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').trim();
    const oldAutoRotation = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').trim();
    try {
        const previousCreate = lastNativeCreate();
        assert.ok(previousCreate, 'The initial native Activity creation must be in the event log.');
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
        adb('shell', 'settings', 'put', 'system', 'user_rotation', oldRotation === '0' ? '1' : '0');
        await expect.poll(() => {
            const currentCreate = lastNativeCreate();
            return Boolean(currentCreate) && currentCreate !== previousCreate;
        }).toBe(true);
        await waitNative();
        await waitAudio();
        await expect.poll(captionsState).toBe('Disable subtitles');
        await back();
        await page.waitForFunction(() => window.__rotationResult === true);
    } finally {
        adb('shell', 'settings', 'put', 'system', 'user_rotation', oldRotation);
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', oldAutoRotation);
    }
    await launchRotationFixture(playlistId, 8);
    await waitNative();
    await waitAudio();
    // Reload while native playback owns the foreground. The new document cannot
    // receive the old player's event, just like a recreated WebView.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await back();
    await page.waitForFunction(() => !document.getElementById('initial-splash'));
    await expect.poll(() => page.evaluate((id) => {
        const stored = JSON.parse(localStorage.getItem('xtream-playback-positions') || '{}');
        const position = stored[id]?.find((item) => item.contentXtreamId === 17)?.positionSeconds;
        return position >= 8 && position < 20;
    }, playlistId), { timeout: 15000 }).toBe(true);
    const retryId = 'synthetic-retry-' + randomUUID();
    await page.evaluate(({ url, retryId }) => {
        const put = Storage.prototype.setItem;
        window.__allowPositionWrite = false;
        window.__positionWriteAttempts = 0;
        window.__nativeResults = 0;
        window.__retryCheckpointIdle = false;
        const requestId = crypto.randomUUID();
        window.addEventListener('iptvnator:android-playback-result', () => window.__nativeResults++);
        window.addEventListener('iptvnator:android-playback-checkpoints-idle', (event) => {
            if (event.detail === requestId) window.__retryCheckpointIdle = true;
        });
        Storage.prototype.setItem = function (key, value) {
            if (key === 'xtream-playback-positions' && !window.__allowPositionWrite) {
                window.__positionWriteAttempts++;
                throw new DOMException('Synthetic quota', 'QuotaExceededError');
            }
            return put.call(this, key, value);
        };
        window.TvShell.postMessage(JSON.stringify(['playNative', requestId, {
            url,
            startTime: 8,
            checkpoint: {
                profile: 'iptvnator',
                playlistId: retryId,
                contentType: 'vod',
                contentXtreamId: 18,
            },
        }]));
    }, { url: origin + '/synthetic-ac3.mkv', retryId });
    await waitNative();
    await waitAudio();
    await back();
    await expect.poll(() => page.evaluate(() => window.__positionWriteAttempts)).toBeGreaterThan(0);
    assert.equal(await page.evaluate(() => window.__retryCheckpointIdle), false,
        'A failed write must retain the native checkpoint and its reset guards.');
    await page.evaluate(() => {
        window.__allowPositionWrite = true;
        const key = 'xtream-playback-positions';
        const positions = JSON.parse(localStorage.getItem(key) || '{}');
        positions.__iptvnator_native_playback_resets__ = { 'synthetic-other-source': Date.now() };
        localStorage.setItem(key, JSON.stringify(positions));
        window.TvShell.postMessage(JSON.stringify(['onReady', location.href]));
    });
    await expect.poll(() => page.evaluate((id) => {
        const stored = JSON.parse(localStorage.getItem('xtream-playback-positions') || '{}');
        return stored[id]?.find((item) => item.contentXtreamId === 18)?.positionSeconds;
    }, retryId)).toBeGreaterThanOrEqual(8);
    await page.waitForFunction(() => window.__retryCheckpointIdle === true);
    await expect.poll(() => page.evaluate(() => JSON.parse(
        localStorage.getItem('xtream-playback-positions') || '{}'
    ).__iptvnator_native_playback_resets__)).toBeUndefined();
    assert.equal(await page.evaluate(() => window.__nativeResults), 1,
        'Checkpoint retry must not replay the original playback result.');
    await expect(entry('Synthetic Unplayable')).toBeVisible({ timeout: 60000 });
    await entry('Synthetic Unplayable').click();
    await expect(stage.locator('app-playback-diagnostic-panel')).toBeVisible();
    await expect(action).toBeVisible();
    await action.click();
    await waitNative();
    await expect.poll(() => dumpLayout().includes('The built-in player could not play this stream')).toBe(true);
    const failedStreamRequests = seen.failedStreamRequests;
    adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY');
    await delay(1000);
    assert.equal(seen.failedStreamRequests, failedStreamRequests,
        'Remote Play must not restart a failed native session.');
    assert.ok(!adb('shell', 'cmd', 'media_session', 'list-sessions').includes(app),
        'A failed native session must also release its system transport controls.');
    await back();
    await expect.poll(() => dumpLayout().includes('This stream cannot be played here')).toBe(true);
    adb('shell', 'input', 'keyevent', '4');
    const persistedId = 'synthetic-relaunch-' + randomUUID();
    await page.evaluate(({ url, playlistId }) => {
        window.__allowPositionWrite = false;
        window.__positionWriteAttempts = 0;
        window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), {
            url, startTime: 8, checkpoint: {
                profile: 'iptvnator', playlistId, contentType: 'vod', contentXtreamId: 19,
            },
        }]));
    }, { url: origin + '/synthetic-ac3.mkv', playlistId: persistedId });
    await waitNative();
    await waitAudio();
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await expect.poll(() => !topActivity().includes(app)).toBe(true);
    await expect.poll(() =>
        adb('shell', 'run-as', app, 'cat', 'shared_prefs/native_playback_checkpoints.xml').includes(persistedId)
    ).toBe(true);
    adb('shell', 'am', 'force-stop', app);
    await device.close();
    adb('shell', 'am', 'start', '-n', `${app}/.ui.MainActivity`);
    device = (await _android.devices({ omitDriverInstall: true })).find((item) => item.serial() === serial);
    const restoredPage = await (await device.webView({ pkg: app })).page();
    await expect.poll(() => restoredPage.evaluate((id) => {
        const stored = JSON.parse(localStorage.getItem('xtream-playback-positions') || '{}');
        return stored[id]?.find((item) => item.contentXtreamId === 19)?.positionSeconds ?? 0;
    }, persistedId), { timeout: 15000 }).toBeGreaterThanOrEqual(8);
    page = restoredPage;
    page.setDefaultTimeout(20000);
    await setExperiment(false);
    console.log('PASS Android Media3 opt-in, mute handoff, VOD resume after Home, WebView reload and failed writes, redirect header scope, extensionless HLS Back, AC-3 audio, captions natural VOD completion and external fallback');
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

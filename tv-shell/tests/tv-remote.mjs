/**
 * Drives the real IPTVnator PWA (served by devserver/server.mjs) in Chromium
 * using nothing but remote-control keys, through the TV layer.
 *
 *   node tests/tv-remote.mjs [--url http://127.0.0.1:43330] [--shots dir]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : args[i + 1];
};
const URL_ = opt('--url', 'http://127.0.0.1:43330');
const SHOTS = opt('--shots', join(dirname(fileURLToPath(import.meta.url)), 'shots'));
const PROVIDER = opt('--provider', 'http://127.0.0.1:43331');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: false });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

let shot = 0;
async function snap(label) {
    shot += 1;
    await page.screenshot({ path: join(SHOTS, `${String(shot).padStart(2, '0')}-${label}.png`) });
}
const state = () => page.evaluate(() => window.__tvShell.state());
const focused = async () => (await state()).active;
async function key(k, times = 1, delay = 150) {
    for (let i = 0; i < times; i++) {
        await page.keyboard.press(k);
        await page.waitForTimeout(delay);
    }
    return focused();
}
let failures = 0;
function check(cond, msg) {
    if (!cond) failures += 1;
    console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
}
/**
 * Explore the focus graph with the D-pad (depth-first, each element tries the
 * four directions in the order given) until the focused element matches `re`.
 */
async function reach(re, keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'], max = 80) {
    const tried = new Map(); // element description → directions already tried from it
    const all = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    const order = keys.concat(all.filter((k) => !keys.includes(k)));
    for (let i = 0; i < max; i++) {
        const f = await focused();
        if (f && re.test(f)) return f;
        const done = tried.get(f) || new Set();
        const next = order.find((k) => !done.has(k)) || order[i % order.length];
        done.add(next);
        tried.set(f, done);
        await key(next);
    }
    return null;
}

console.log('1. load');
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await snap('loaded');
check(await page.evaluate(() => !!window.__tvShell), 'TV layer present');
check(await page.evaluate(() => !document.getElementById('initial-splash')), 'Angular bootstrapped');
console.log('  focused:', await focused());

console.log('2. rail → Sources → "Add Xtream" with the D-pad only');
let f = await reach(/\[Sources\]/, ['ArrowDown']);
check(!!f, 'reached the Sources rail item: ' + f);
await key('Enter');
await page.waitForTimeout(900);
f = await reach(/Add Xtream/i, ['ArrowRight', 'ArrowDown']);
check(!!f, 'reached "Add Xtream": ' + f);
await snap('sources');
await key('Enter');
await page.waitForTimeout(900);
let st = await state();
check(st.scope === 'overlay', 'dialog opened and captured the scope (' + st.active + ')');

console.log('3. fill the Xtream form');
check(await page.evaluate(() => /Xtream/i.test((document.querySelector('.apd-method.active') || {}).textContent || '')), 'method "Xtream credentials" preselected by the "Add Xtream" card');
const fields = [
    [/title|titre/i, 'Mock portal'],
    [/server|serveur|url/i, PROVIDER],
    [/username|utilisateur/i, 'user'],
    [/password|mot de passe/i, 'pass'],
];
for (const [re, value] of fields) {
    f = await reach(new RegExp('^input.*' + re.source, 'i'), ['ArrowDown'], 12);
    check(!!f, 'field focused: ' + f);
    if (f) await page.keyboard.type(value, { delay: 5 });
}
await snap('form-filled');
// Arrows reach the page only while the caret can still move: Left at the end of the
// typed value is the browser's, Left at the start is the D-pad's (the layer stops it).
await page.evaluate(() => {
    window.__arrowSeen = 0;
    window.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) window.__arrowSeen += 1; });
});
await page.keyboard.press('ArrowLeft');
const passedThrough = await page.evaluate(() => window.__arrowSeen);
await page.evaluate(() => document.activeElement.setSelectionRange(0, 0));
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
const takenByDpad = (await page.evaluate(() => window.__arrowSeen)) === passedThrough;
check(passedThrough === 1 && takenByDpad, 'arrows pass through a text field only while the caret can move');
f = await reach(/^button.*"Add"$|^button.*\bAdd\b/i, ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight'], 12);
check(!!f, 'submit button focused: ' + f);
await key('Enter');
await page.waitForTimeout(3500);
await snap('after-submit');
st = await state();
console.log('  url:', page.url());
check(/xtream|portal|workspace/i.test(page.url()) && st.scope === 'document', 'dialog closed, portal opened: ' + st.active);

console.log('4. browse Live TV with the D-pad');
f = await reach(/\[Live/i, ['ArrowLeft', 'ArrowDown']);
console.log('  focused:', f);
await key('Enter');
await page.waitForTimeout(1500);
await snap('live');
const path = [];
for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) {
    path.push(k.replace('Arrow', '') + '→' + ((await key(k)) || '∅').slice(0, 60));
}
console.log('  ' + path.join('\n  '));
f = await reach(/Channel \d/i, ['ArrowRight', 'ArrowDown']);
check(!!f, 'a channel row is focusable: ' + f);
await snap('channels');
await key('Enter');
await page.waitForTimeout(2000);
await snap('channel-selected');
st = await state();
const streamUrl = await page.evaluate(() => window.__tvShell.currentStreamUrl());
console.log('  after Enter on channel:', st.active);
check(!!streamUrl, 'stream URL known for the external player: ' + streamUrl);

console.log('5. Back / Menu');
let handled = await page.evaluate(() => window.__tvShell.back());
await page.waitForTimeout(800);
console.log('  back →', handled, '| url:', page.url(), '| focused:', await focused());
await snap('after-back');
await page.evaluate(() => window.__tvShell.menu());
await page.waitForTimeout(700);
st = await state();
console.log('  menu → scope:', st.scope, '| focused:', st.active);
await snap('after-menu');
handled = await page.evaluate(() => window.__tvShell.back());
await page.waitForTimeout(500);
st = await state();
check(st.scope === 'document', 'Back closed the context menu (' + st.active + ')');

console.log('6. Settings page reachable; movies/series rails');
f = await reach(/\[Open settings\]/i, ['ArrowLeft', 'ArrowDown']);
check(!!f, 'settings focused: ' + f);
await key('Enter');
await page.waitForTimeout(1200);
await snap('settings');
console.log('  focused:', await focused());
const walk = [];
for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown']) walk.push((await key(k)) || '∅');
console.log('  ' + walk.map((w) => w.slice(0, 70)).join('\n  '));

console.log('7. Back walks up to the root, then arms the exit instead of dead presses');
let armed = false;
for (let i = 0; i < 8 && !armed; i++) {
    const canGoBack = await page.evaluate(() => window.__tvShell.state().canGoBack);
    const r = await page.evaluate(() => window.__tvShell.back());
    await page.waitForTimeout(700);
    console.log('  back #' + (i + 1) + ': canGoBack=' + canGoBack + ' handled=' + r + ' url=' + new URL(page.url()).pathname);
    if (r === false) armed = true;
}
check(armed, 'Back reaches the exit prompt within a few presses');

if (consoleErrors.length) {
    console.log('console errors (' + consoleErrors.length + '):');
    for (const e of consoleErrors.slice(0, 10)) console.log('  - ' + e.slice(0, 200));
}
console.log('8. the stream handed to an external player is the source, never a fetched segment');
{
    // The request patterns of the app's engines, each after attaching a new
    // MediaSource as they do. The requests may fail (CORS, 404): tracking
    // happens when they are issued.
    const tracked = await page.evaluate(async (provider) => {
        const last = () => window.__tvShell.state().lastMediaUrl;
        const attach = () => URL.createObjectURL(new MediaSource());
        // A MediaSource really attached to an element, as the engines do.
        const open = async () => {
            const ms = new MediaSource();
            const video = document.createElement('video');
            const url = URL.createObjectURL(ms);
            const opened = new Promise((resolve) => ms.addEventListener('sourceopen', resolve, { once: true }));
            video.src = url;
            await opened;
            return { ms, video, url };
        };
        // Engine teardown: the element drops the source and the MediaSource closes.
        const detach = async ({ ms, video }) => {
            const closed = new Promise((resolve) => ms.addEventListener('sourceclose', resolve, { once: true }));
            video.removeAttribute('src');
            video.load();
            await closed;
        };
        // shaka: attach, revoke the object URL as soon as the source opens, then load.
        const shakaAttach = async () => {
            const media = await open();
            URL.revokeObjectURL(media.url);
            return media;
        };
        const xhr = (url, responseType) => {
            const r = new XMLHttpRequest();
            r.open('GET', url);
            if (responseType) r.responseType = responseType;
            try { r.send(); } catch (e) { /* ignore */ }
        };
        // Aborted at once: the request is issued (and tracked) without reaching the network.
        const get = (url, init) => fetch(url, Object.assign({ signal: AbortSignal.abort() }, init)).catch(() => null);
        const out = {};
        // hls.js / VHS: playlist as text, variant playlist, segments as arraybuffer.
        attach();
        xhr(provider + '/live/user/pass/7.m3u8');
        xhr(provider + '/hls/user/pass/7/index.m3u8');
        xhr(provider + '/hls/user/pass/7_000001.ts', 'arraybuffer');
        out.hls = last();
        // hls.js recoverMediaError: a new MediaSource, then a refresh of the variant.
        attach();
        xhr(provider + '/hls/user/pass/7/index.m3u8');
        out.hlsRecovered = last();
        // A copied URL (an EPG catch-up link) while that stream plays.
        await navigator.clipboard.writeText(provider + '/timeshift/user/pass/60/2026-10-14:08-00/7.ts').catch(() => null);
        xhr(provider + '/hls/user/pass/7/index.m3u8');
        out.afterCopy = last();
        // shaka (DASH): manifest, init segment and media segments, all through fetch.
        const dashMedia = await shakaAttach();
        get(provider + '/dash/user/pass/9.mpd');
        get(provider + '/dash/user/pass/init-v.mp4');
        get(provider + '/dash/user/pass/seg-1.m4s', { headers: { Range: 'bytes=0-99' } });
        out.dash = last();
        // A copy while that DASH channel plays (its object URL is already revoked).
        await navigator.clipboard.writeText(provider + '/timeshift/user/pass/60/2026-10-14:09-00/9.ts').catch(() => null);
        out.dashAfterCopy = last();
        // shaka MediaSource reset (codec switch): new MediaSource, next segments, manifest refresh.
        await shakaAttach();
        await detach(dashMedia); // the old MediaSource closes after the new one exists
        get(provider + '/dash/user/pass/init-a.mp4');
        get(provider + '/dash/user/pass/seg-2.m4s');
        out.dashReset = last();
        get(provider + '/dash/user/pass/9.mpd');
        out.dashRefreshed = last();
        // mpegts.js on the next channel: a new MediaSource, then the raw TS stream.
        attach();
        get(provider + '/live/user/pass/8.ts');
        out.ts = last();
        // An M3U channel whose URL has no extension (mpegts.js too).
        attach();
        get(provider + '/user/pass/10');
        out.bare = last();
        // A DASH channel whose manifest URL has no extension, after another channel.
        await shakaAttach();
        get(provider + '/c/7?format=mpd');
        get(provider + '/dash/user/pass/seg-3.m4s');
        out.dashBare = last();
        // An rtmp channel: mpegts.js fetches it (and fails); VLC can play it.
        attach();
        get('rtmp://cam.test/live/key');
        out.rtmp = last();
        // A multicast UDP channel keeps its '@'.
        attach();
        get('udp://@239.0.0.1:1234');
        out.udp = last();
        // A stream hosted on a Google CDN host.
        attach();
        get('https://storage.googleapis.com/bucket/live/index.m3u8');
        out.google = last();
        // An engine that re-attaches only once its old source has closed: the
        // session has ended, the variant refresh still matches the previous stream.
        let media = await open();
        xhr(provider + '/live/user/pass/11.m3u8');
        xhr(provider + '/hls/user/pass/11/index.m3u8');
        URL.revokeObjectURL(media.url);
        await detach(media);
        await open();
        xhr(provider + '/hls/user/pass/11/index.m3u8');
        out.closedRecovery = last();
        // hls.js recoverMediaError as it runs: revoke, drop the source and attach a
        // new MediaSource to the same element in one go; the old sourceclose comes after.
        media = await open();
        xhr(provider + '/live/user/pass/14.m3u8');
        xhr(provider + '/hls/user/pass/14/index.m3u8');
        {
            const closed = new Promise((resolve) => media.ms.addEventListener('sourceclose', resolve, { once: true }));
            URL.revokeObjectURL(media.url);
            media.video.removeAttribute('src');
            media.video.load();
            const ms = new MediaSource();
            const opened = new Promise((resolve) => ms.addEventListener('sourceopen', resolve, { once: true }));
            media.video.src = URL.createObjectURL(ms);
            await Promise.all([closed, opened]);
        }
        xhr(provider + '/hls/user/pass/14/index.m3u8');
        out.syncRecovery = last();
        // The player is torn down; "Copy stream URL" on an item that never played.
        media = await open();
        xhr(provider + '/live/user/pass/12.m3u8');
        await detach(media);
        await navigator.clipboard.writeText(provider + '/movie/user/pass/13.mkv').catch(() => null);
        out.copyAfterTeardown = last();
        return out;
    }, PROVIDER);
    const expect = (key, url, label) => check(tracked[key] === PROVIDER + url, label + ': ' + tracked[key]);
    expect('hls', '/live/user/pass/7.m3u8', 'HLS: the playlist, not a variant or a segment');
    expect('hlsRecovered', '/live/user/pass/7.m3u8', 'HLS error recovery keeps the playlist');
    expect('afterCopy', '/live/user/pass/7.m3u8', 'a copied URL does not replace the playing stream');
    expect('dash', '/dash/user/pass/9.mpd', 'DASH through fetch: the manifest, not a segment');
    expect('dashAfterCopy', '/dash/user/pass/9.mpd', 'a copied URL does not replace the playing DASH stream');
    expect('dashReset', '/dash/user/pass/9.mpd', 'a DASH MediaSource reset keeps the manifest');
    expect('dashRefreshed', '/dash/user/pass/9.mpd', 'and so does the manifest refresh after it');
    expect('ts', '/live/user/pass/8.ts', 'the next channel replaces the previous stream');
    expect('bare', '/user/pass/10', 'a stream URL without an extension is still the stream');
    expect('dashBare', '/c/7?format=mpd', 'a DASH manifest URL without an extension is the stream');
    check(tracked.rtmp === 'rtmp://cam.test/live/key', 'an rtmp stream is the stream: ' + tracked.rtmp);
    check(tracked.udp === 'udp://@239.0.0.1:1234', 'a multicast udp stream keeps its @: ' + tracked.udp);
    check(tracked.google === 'https://storage.googleapis.com/bucket/live/index.m3u8', 'a stream on a Google host is the stream: ' + tracked.google);
    expect('closedRecovery', '/live/user/pass/11.m3u8', 'recovery after the old source closed keeps the playlist');
    expect('syncRecovery', '/live/user/pass/14.m3u8', 'hls.js recovery (re-attach before the old source closes) keeps the playlist');
    expect('copyAfterTeardown', '/movie/user/pass/13.mkv', 'once the player is gone, a copied URL is the stream');
}
console.log('9. under the Android bridge: the screen follows playback, error codes, detached players');
{
    // A second page with a recording stand-in for the Android bridge (window.TvShell).
    const bridged = await context.newPage();
    await bridged.addInitScript(() => {
        window.__calls = [];
        window.TvShell = {};
        ['onReady', 'openExternal', 'onUrlCopied', 'onPlaybackError', 'exitApp', 'showExitHint', 'toast', 'showKeyboard', 'openSettings', 'log', 'setKeepScreenOn']
            .forEach((m) => { window.TvShell[m] = (...a) => { window.__calls.push([m].concat(a.map(String)).join(' ')); }; });
    });
    await bridged.goto(URL_, { waitUntil: 'networkidle' });
    await bridged.waitForTimeout(1500);
    check(await bridged.evaluate(() => window.__calls.some((c) => c.startsWith('onReady '))), 'onReady reaches the bridge');
    const r = await bridged.evaluate(async (provider) => {
        const out = {};
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const since = () => { const n = window.__calls.length; return () => window.__calls.slice(n); };
        const video = document.createElement('video');
        video.muted = true;
        video.src = provider + '/movie/user/pass/clip.webm';
        document.body.appendChild(video);
        // (a) the screen stays on while something really plays, and only then
        let recent = since();
        await video.play().catch(() => null);
        await wait(400);
        out.playing = recent();
        recent = since();
        video.pause();
        await wait(150);
        out.paused = recent();
        // (b) a dropped connection does not offer the external player, a format it cannot play does
        recent = since();
        Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code: 2 }) });
        video.dispatchEvent(new Event('error'));
        await wait(600);
        out.networkError = recent();
        recent = since();
        Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code: 4 }) });
        video.dispatchEvent(new Event('error'));
        await wait(600);
        out.formatError = recent();
        // (c) the player of a page the user left is not what the remote controls
        video.dispatchEvent(new Event('play')); // the layer remembers the element
        out.attached = window.__tvShell.media('pause');
        video.remove();
        out.detached = window.__tvShell.media('playpause');
        return out;
    }, PROVIDER);
    check(r.playing.includes('setKeepScreenOn true'), 'playback keeps the screen on: ' + r.playing.join(' | '));
    check(r.paused.includes('setKeepScreenOn false'), 'pause lets the screen sleep again: ' + r.paused.join(' | '));
    check(!r.networkError.some((c) => c.startsWith('onPlaybackError')), 'a network error (code 2) does not offer the external player');
    check(r.formatError.some((c) => c.startsWith('onPlaybackError') && c.endsWith(' 4')), 'a format error (code 4) does: ' + r.formatError.join(' | '));
    check(r.attached === true && r.detached === false, 'a detached player is no longer the media the remote controls');
    await bridged.close();
}

console.log('10. D-pad robustness: queued repeats, snack bars, animated rails');
{
    const r = await page.evaluate(() => {
        const out = {};
        const host = document.createElement('div');
        host.innerHTML = '<div id="tvt-scroller" style="position:fixed;left:0;top:0;width:300px;height:120px;overflow:auto;scroll-behavior:smooth;background:#000;z-index:99999">'
            + Array.from({ length: 12 }, (_, i) => '<button id="tvt-b' + i + '" style="display:block;height:40px;width:200px">row ' + i + '</button>').join('') + '</div>'
            + '<div class="cdk-overlay-container"><div class="cdk-overlay-pane" style="position:fixed;right:0;bottom:0;z-index:99999"><div class="mat-mdc-snack-bar-container"><button id="tvt-close">Close</button></div></div></div>';
        document.body.appendChild(host);
        const scroller = document.getElementById('tvt-scroller');
        const press = (age) => {
            const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true });
            if (age) Object.defineProperty(ev, 'timeStamp', { value: performance.now() - age });
            document.activeElement.dispatchEvent(ev);
        };
        document.getElementById('tvt-b0').focus();
        press(0);
        out.afterFresh = document.activeElement.id;
        press(500); // 500 ms old, right after the previous one: a repeat that sat in the queue
        out.afterQueued = document.activeElement.id;
        for (let i = 0; i < 4; i++) press(0);
        out.focusedRow = document.activeElement.id;
        out.scrollTop = scroller.scrollTop; // read at once: the scroll must not be animated
        document.getElementById('tvt-close').focus();
        out.scope = window.__tvShell.state().scope;
        host.remove();
        return out;
    });
    check(r.afterFresh === 'tvt-b1', 'a fresh arrow moves the focus: ' + r.afterFresh);
    check(r.afterQueued === 'tvt-b1', 'a queued repeat right after it is dropped: ' + r.afterQueued);
    check(r.focusedRow === 'tvt-b5' && r.scrollTop > 0, 'a smooth-scroll rail scrolls at once (row ' + r.focusedRow + ', scrollTop ' + r.scrollTop + ')');
    check(r.scope === 'document', 'a snack bar does not become the navigation scope: ' + r.scope);
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
await browser.close();

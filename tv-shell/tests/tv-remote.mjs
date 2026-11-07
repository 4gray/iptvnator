/**
 * Drives the real IPTVnator PWA (served by devserver/server.mjs) in Chromium
 * using nothing but remote-control keys, through the TV layer.
 *
 *   node tests/tv-remote.mjs [--url http://127.0.0.1:43330] [--shots dir]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
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
const bridgeLogs = [];
page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.text().startsWith('[tvshell] bridge.')) bridgeLogs.push(msg.text());
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

console.log('1b. real Material checkbox remains reachable and visibly focused');
await page.goto(URL_ + '/workspace/sources', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Add Stalker/i }).click();
const materialDialog = page.locator('mat-dialog-container');
const materialCheckbox = materialDialog.locator('mat-checkbox input[type="checkbox"]').first();
await materialCheckbox.waitFor({ state: 'attached' });
const advancedSettings = materialDialog.locator('details').filter({ has: page.locator('mat-checkbox') });
if (!(await advancedSettings.evaluate((details) => details.open))) await advancedSettings.locator('summary').click();
await materialCheckbox.waitFor({ state: 'visible' });
await materialDialog.locator('input[type="text"]').first().focus();
const materialFocus = await reach(/^input.*mdc-checkbox__native-control/, ['ArrowDown'], 30);
check(!!materialFocus, 'D-pad reaches the transparent native input of a visible Material checkbox');
if (materialFocus) {
    const materialInput = page.locator('mat-checkbox input[type="checkbox"]:focus');
    const checked = await materialInput.isChecked();
    check(await materialInput.evaluate((input) => {
        const style = getComputedStyle(input.closest('mat-checkbox'));
        return style.opacity !== '0' && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    }), 'focus ring is painted on the visible Material component');
    await key('Enter');
    check(await materialInput.isChecked() !== checked, 'OK toggles the real Material checkbox once');
    await key('Enter');
    check(await materialInput.isChecked() === checked, 'another OK restores its original state');
}
await key('Escape');

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

console.log('3b. source switcher keeps its expanded combobox keyboard navigation');
await page.locator('[data-test-id="playlist-switcher-trigger"]').focus();
await key('Enter');
const switcherSearch = page.locator('app-playlist-switcher-panel input[role="combobox"]');
await switcherSearch.waitFor({ state: 'visible' });
await page.waitForFunction(() => document.activeElement?.matches('app-playlist-switcher-panel input[role="combobox"]'));
for (const arrow of ['ArrowDown', 'ArrowUp']) {
    await key(arrow);
    check(await switcherSearch.evaluate((input) => input === document.activeElement &&
        document.getElementById(input.getAttribute('aria-activedescendant'))?.getAttribute('role') === 'option'),
        arrow + ' highlights a source while focus stays in the search field');
}
await key('ArrowRight');
check(await switcherSearch.evaluate((input) => input !== document.activeElement &&
    !!document.activeElement.closest('app-playlist-switcher-panel')),
    'Right at the empty search caret boundary reaches another switcher control');
await switcherSearch.fill('sy');
await switcherSearch.focus();
await switcherSearch.evaluate((input) => input.setSelectionRange(1, 1));
await key('ArrowLeft');
check(await switcherSearch.evaluate((input) => input === document.activeElement && input.selectionStart === 0),
    'horizontal arrows still move the caret inside an expanded search');
await switcherSearch.fill('');
await key('ArrowDown');
await key('F10');
check(await page.locator('.cdk-overlay-pane [role="menu"]').count() === 1,
    'Menu opens the highlighted source actions from the search field');
if (await page.locator('.cdk-overlay-pane [role="menu"]').count()) await key('Escape');
await switcherSearch.focus();
await key('Enter');
check(await page.locator('app-playlist-switcher-panel').count() === 0, 'OK selects a source and closes the switcher');
// Keep subsequent checks useful if the regression is present.
if (await page.locator('app-playlist-switcher-panel').count()) await key('Escape');

const menuEvents = await page.evaluate(() => {
    const previous = document.activeElement;
    const button = document.createElement('button');
    button.textContent = 'Synthetic context action';
    document.body.appendChild(button);
    const events = { keyboard: 0, mouse: 0 };
    button.addEventListener('keydown', (event) => {
        if (event.key === 'ContextMenu') {
            events.keyboard += 1;
            if (events.keyboard === 1) event.preventDefault();
        }
    });
    button.addEventListener('contextmenu', (event) => { event.preventDefault(); events.mouse += 1; });
    button.focus();
    window.__tvShell.menu();
    window.__tvShell.menu();
    button.remove();
    previous.focus();
    return events;
});
check(menuEvents.keyboard === 2 && menuEvents.mouse === 1,
    'Menu honors keyboard handling and preserves the mouse fallback when unhandled');

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
await page.evaluate(async (provider) => {
    await navigator.clipboard.writeText(provider + '/live/synthetic-account/synthetic-bridge-secret/42.ts');
    window.__tvShell.openExternal();
}, PROVIDER);
check(bridgeLogs.some((message) => message.includes('bridge.onUrlCopied')) &&
    bridgeLogs.some((message) => message.includes('bridge.openExternal')) &&
    bridgeLogs.every((message) => !/https?:\/\/|synthetic-bridge-secret/.test(message)),
    'browser-emulation bridge logs retain method names without stream URLs or credentials');
console.log('9. under the Android bridge: the screen follows playback, error codes, detached players');
{
    // A second page with a recording stand-in for the Android bridge (window.TvShell).
    const bridged = await context.newPage();
    await bridged.addInitScript(() => {
        window.__calls = [];
        window.TvShell = { postMessage: (data) => { window.__calls.push(JSON.parse(data).map(String).join(' ')); } };
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
        // (d) leaving a page while it plays: the element is removed first, then pauses
        const leaving = document.createElement('video');
        leaving.muted = true;
        leaving.loop = true;
        leaving.src = provider + '/movie/user/pass/clip.webm';
        const wrapper = document.createElement('div');
        wrapper.appendChild(leaving);
        document.body.appendChild(wrapper);
        recent = since();
        await leaving.play().catch(() => null);
        await wait(400);
        out.leavingPlaying = recent();
        recent = since();
        wrapper.remove(); // Chromium pauses a removed media element; its events no longer reach the document
        await wait(400);
        out.leavingRemoved = recent();
        const engineVideo = document.createElement('video');
        const source = new MediaSource();
        const opened = new Promise((resolve) => source.addEventListener('sourceopen', resolve, { once: true }));
        engineVideo.src = URL.createObjectURL(source);
        document.body.appendChild(engineVideo);
        await opened;
        const request = new XMLHttpRequest();
        request.open('GET', provider + '/live/synthetic-account/synthetic-secret/unsupported.m3u8');
        const diagnostic = document.createElement('section');
        recent = since();
        document.body.appendChild(diagnostic);
        const issue = (code) => diagnostic.dispatchEvent(new CustomEvent('iptvnator:playback-issue', { bubbles: true, detail: { code } }));
        issue('network-error');
        await wait(150);
        out.engineNetworkError = recent();
        issue('unsupported-codec');
        await wait(150);
        out.engineFormatError = recent().filter((call) => call.startsWith('onPlaybackError '));
        out.engineNativeErrorAbsent = engineVideo.error === null;
        issue('unsupported-codec');
        await wait(150);
        out.engineDuplicateError = recent().filter((call) => call.startsWith('onPlaybackError '));
        engineVideo.dispatchEvent(new Event('loadstart'));
        issue('unsupported-codec');
        await wait(150);
        out.engineInsertedError = recent().filter((call) => call.startsWith('onPlaybackError '));
        diagnostic.remove();
        engineVideo.removeAttribute('src');
        engineVideo.load();
        engineVideo.remove();
        // A decode error may outlive the element or the load attempt that raised it.
        const failedVideo = (name) => {
            const element = document.createElement('video');
            Object.defineProperty(element, 'currentSrc', { configurable: true, value: provider + '/movie/synthetic-account/synthetic-secret/' + name + '.mp4' });
            Object.defineProperty(element, 'error', { value: { code: 4 } });
            document.body.appendChild(element);
            element.dispatchEvent(new Event('loadstart'));
            return element;
        };
        const oldPlayer = failedVideo('old');
        recent = since();
        oldPlayer.dispatchEvent(new Event('error'));
        oldPlayer.remove();
        const nextPlayer = failedVideo('replacement');
        await wait(600);
        out.removedPlayerError = recent();
        recent = since();
        nextPlayer.dispatchEvent(new Event('error'));
        nextPlayer.dispatchEvent(new Event('loadstart')); // same URL, fresh attempt
        await wait(600);
        out.retriedPlayerError = recent();
        recent = since();
        nextPlayer.dispatchEvent(new Event('error'));
        Object.defineProperty(nextPlayer, 'currentSrc', { value: provider + '/movie/synthetic-account/synthetic-secret/changed.mp4' });
        await wait(600);
        out.changedPlayerError = recent();
        recent = since();
        nextPlayer.dispatchEvent(new Event('error'));
        await wait(600);
        out.currentPlayerError = recent();
        nextPlayer.remove();
        const backgroundMedia = document.createElement('audio');
        let pauseCalls = 0;
        backgroundMedia.pause = () => { pauseCalls++; };
        document.body.appendChild(backgroundMedia);
        window.__tvShell.setForeground(false);
        out.backgroundPause = pauseCalls;
        backgroundMedia.dispatchEvent(new Event('play'));
        out.backgroundRetry = pauseCalls;
        window.__tvShell.setForeground(true);
        backgroundMedia.dispatchEvent(new Event('play'));
        out.foregroundPlay = pauseCalls;
        backgroundMedia.remove();
        return out;
    }, PROVIDER);
    check(r.playing.includes('setKeepScreenOn true'), 'playback keeps the screen on: ' + r.playing.join(' | '));
    check(r.paused.includes('setKeepScreenOn false'), 'pause lets the screen sleep again: ' + r.paused.join(' | '));
    check(!r.networkError.some((c) => c.startsWith('onPlaybackError')), 'a network error (code 2) does not offer the external player');
    check(r.formatError.some((c) => c.startsWith('onPlaybackError') && c.endsWith(' 4')), 'a format error (code 4) does: ' + r.formatError.join(' | '));
    check(r.attached === true && r.detached === false, 'a detached player is no longer the media the remote controls');
    check(r.leavingPlaying.includes('setKeepScreenOn true') && r.leavingRemoved.includes('setKeepScreenOn false'),
        'leaving a playing page lets the screen sleep: ' + r.leavingPlaying.join(' | ') + ' then ' + r.leavingRemoved.join(' | '));
    check(!r.engineNetworkError.some((call) => call.startsWith('onPlaybackError ')),
        'engine-level network errors do not offer the external player');
    check(r.engineNativeErrorAbsent && r.engineFormatError.length === 1 && r.engineFormatError[0].endsWith(' 4'),
        'an engine codec failure offers the external player without a native media error');
    check(r.engineDuplicateError.length === 1, 'the same engine failure offers the external player once');
    check(r.engineInsertedError.length === 2, 'a new load attempt can offer one prompt even when its codec diagnostic is unchanged');
    check(!r.removedPlayerError.some((call) => call.startsWith('onPlaybackError ')), 'a removed player cannot offer recovery for its replacement');
    check(!r.retriedPlayerError.some((call) => call.startsWith('onPlaybackError ')), 'a fresh attempt of the same source discards the previous delayed error');
    check(!r.changedPlayerError.some((call) => call.startsWith('onPlaybackError ')), 'changing source before loadstart also discards the old error');
    check(r.currentPlayerError.filter((call) => call.startsWith('onPlaybackError ')).length === 1, 'a current unrecovered decode error still offers one recovery prompt');
    check(r.backgroundPause === 1, 'backgrounding pauses existing media');
    check(r.backgroundRetry === 2, 'backgrounding blocks a late playback retry');
    check(r.foregroundPlay === 2, 'returning to foreground permits explicit playback');
    const bridgeFailures = [];
    bridged.on('console', (message) => {
        if (message.text().startsWith('[tvshell]')) bridgeFailures.push(message.text());
    });
    await bridged.evaluate(async (provider) => {
        window.__tvShellDebug = true;
        await navigator.clipboard.writeText(provider + '/live/synthetic-account/synthetic-bridge-secret/42.ts');
        window.TvShell.postMessage = () => { throw new Error('synthetic-bridge-secret'); };
        window.__tvShell.openExternal();
    }, PROVIDER);
    check(bridgeFailures.some((message) => message.includes('bridge.openExternal failed')) &&
        bridgeFailures.every((message) => !message.includes('synthetic-bridge-secret')),
        'bridge failure logs omit exception text that can contain credentials');
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
        const release = () => document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
        document.getElementById('tvt-b0').focus();
        press(0);
        out.afterFresh = document.activeElement.id;
        press(500); // 500 ms old, right after the previous one: a repeat that sat in the queue
        out.afterQueued = document.activeElement.id;
        release();
        press(500); // just as late, but released in between: a second press, kept
        out.afterReleased = document.activeElement.id;
        for (let i = 0; i < 3; i++) {
            release(); // three taps: a held key would wait for each move to be drawn
            press(0);
        }
        release();
        out.focusedRow = document.activeElement.id;
        out.scrollTop = scroller.scrollTop; // read at once: the scroll must not be animated
        document.getElementById('tvt-close').focus();
        out.scope = window.__tvShell.state().scope;
        host.remove();
        return out;
    });
    // A held key moves once per drawn frame: a repeat that comes before the move is on screen is
    // dropped, the next one after the frame moves again.
    const held = await page.evaluate(async () => {
        const host = document.createElement('div');
        host.innerHTML = '<div style="position:fixed;left:0;top:0;width:300px;height:400px;overflow:auto;background:#000;z-index:99999">'
            + Array.from({ length: 8 }, (_, i) => '<button id="tvt-h' + i + '" style="display:block;height:40px;width:200px">held ' + i + '</button>').join('') + '</div>';
        document.body.appendChild(host);
        await new Promise((resolve) => setTimeout(resolve, 300)); // clear of the previous arrow
        const repeat = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        document.getElementById('tvt-h0').focus();
        const out = {};
        repeat();
        out.first = document.activeElement.id;
        repeat(); // same frame: the move above is not drawn yet
        out.sameFrame = document.activeElement.id;
        await frame();
        repeat();
        out.nextFrame = document.activeElement.id;
        document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
        host.remove();
        return out;
    });
    // The next row a list already rendered past the bottom edge is the next stop, at once: the list
    // moves by about a row, not by a page followed by a second look 60 ms later.
    const reach = await page.evaluate(async () => {
        const pane = document.createElement('div');
        pane.className = 'cdk-overlay-pane'; // its own scope: the app's buttons are not candidates
        pane.style.cssText = 'position:fixed;left:0;top:10px;z-index:99999';
        pane.innerHTML = '<div id="tvt-reach" style="width:300px;height:710px;overflow:auto;background:#000">'
            + Array.from({ length: 20 }, (_, i) => '<button id="tvt-n' + i + '" style="display:block;height:52px;width:200px;margin-bottom:20px">row ' + i + '</button>').join('') + '</div>';
        document.body.appendChild(pane);
        await new Promise((resolve) => setTimeout(resolve, 300)); // clear of the previous arrow
        const list = document.getElementById('tvt-reach');
        document.getElementById('tvt-n9').focus(); // its bottom at 710; the next row starts past the window
        const below = document.getElementById('tvt-n10').getBoundingClientRect().top;
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
        const out = { below, focused: document.activeElement.id, scrolled: list.scrollTop, page: list.clientHeight }; // read at once
        document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150)); // let a second look run before the list goes
        pane.remove();
        return out;
    });
    // With nothing to land on, a page that ends in text scrolls by most of a page, while a virtual
    // list whose rendered rows ran out scrolls one row; and two repeats on the picture before its
    // controls come back move the focus once, not twice.
    const fallback = await page.evaluate(async () => {
        const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const key = (type) => document.activeElement.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
        const mount = (html) => {
            const pane = document.createElement('div');
            pane.className = 'cdk-overlay-pane'; // its own scope: the app's buttons are not candidates
            pane.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
            pane.innerHTML = html;
            document.body.appendChild(pane);
            return pane;
        };
        const scrollAfterDown = async (html, scrollerId, buttonId) => {
            const pane = mount(html);
            await settle(300); // clear of the previous arrow
            document.getElementById(buttonId).focus();
            key('keydown');
            const scroller = document.getElementById(scrollerId);
            const out = { scrolled: scroller.scrollTop, page: scroller.clientHeight }; // read at once
            key('keyup');
            await settle(150); // let the second look run before the scroller goes
            pane.remove();
            return out;
        };
        const text = await scrollAfterDown('<div id="tvt-text" style="width:400px;height:600px;overflow:auto;background:#000;color:#fff">'
            + '<button id="tvt-t0" style="display:block;height:40px;width:200px">only button</button><p style="height:3000px">text</p></div>', 'tvt-text', 'tvt-t0');
        const virtual = await scrollAfterDown('<cdk-virtual-scroll-viewport id="tvt-v" style="display:block;width:400px;height:600px;overflow:auto;background:#000">'
            + '<button id="tvt-v0" style="display:block;height:52px;width:200px">row</button><div style="height:3000px"></div></cdk-virtual-scroll-viewport>', 'tvt-v', 'tvt-v0');
        const pane = mount('<div class="tvt-player" style="position:relative;width:640px;height:480px;background:#000">'
            + '<video id="tvt-vid" tabindex="0" style="width:640px;height:300px;display:block"></video>'
            + '<div id="tvt-controls" style="display:none"><button id="tvt-c1" style="display:block;height:40px">c1</button><button id="tvt-c2" style="display:block;height:40px">c2</button></div></div>');
        const controls = document.getElementById('tvt-controls');
        pane.querySelector('.tvt-player').addEventListener('pointermove', () => setTimeout(() => { controls.style.display = 'block'; }, 80));
        await settle(300);
        document.getElementById('tvt-vid').focus();
        key('keydown');
        await settle(50);
        key('keydown'); // held: a repeat 50 ms later, still on the picture
        key('keyup');
        await settle(400);
        const fromPicture = document.activeElement.id;
        pane.remove();
        return { text, virtual, fromPicture };
    });
    // A rail with nothing on screen to land on: only the layer's own scroll moves it, and at once.
    const railScroll = await page.evaluate(async () => {
        const pane = document.createElement('div');
        pane.className = 'cdk-overlay-pane'; // its own scope: the app's buttons are not candidates
        pane.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
        pane.innerHTML = '<div id="tvt-rail" style="display:flex;width:300px;height:60px;overflow-x:auto;scroll-behavior:smooth;background:#000">'
            + '<button id="tvt-r0" style="flex:none;width:200px">first</button><div style="flex:none;width:2000px"></div>'
            + '<button id="tvt-r1" style="flex:none;width:200px">past the edge</button></div>';
        document.body.appendChild(pane);
        await new Promise((resolve) => setTimeout(resolve, 300)); // clear of the previous arrow
        document.getElementById('tvt-r0').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
        const scrolled = document.getElementById('tvt-rail').scrollLeft; // read at once: never animated
        await new Promise((resolve) => setTimeout(resolve, 150)); // let move()'s retry run before the rail goes
        pane.remove();
        return scrolled;
    });
    check(r.afterFresh === 'tvt-b1', 'a fresh arrow moves the focus: ' + r.afterFresh);
    check(r.afterQueued === 'tvt-b1', 'a queued repeat right after it is dropped: ' + r.afterQueued);
    check(r.afterReleased === 'tvt-b2', 'a second press after a keyup is kept even when late: ' + r.afterReleased);
    check(r.focusedRow === 'tvt-b5' && r.scrollTop > 0, 'a smooth-scroll rail scrolls at once (row ' + r.focusedRow + ', scrollTop ' + r.scrollTop + ')');
    check(held.first === 'tvt-h1' && held.sameFrame === 'tvt-h1', 'a held key waits for the move to be drawn: ' + held.first + ', ' + held.sameFrame);
    check(held.nextFrame === 'tvt-h2', 'the next repeat after the frame moves again: ' + held.nextFrame);
    check(reach.below > 720 && reach.focused === 'tvt-n10' && reach.scrolled > 0 && reach.scrolled < reach.page * 0.3,
        'the next row past the bottom edge is the next stop, one row down: ' + reach.focused + ', scrollTop ' + reach.scrolled);
    check(fallback.text.scrolled > fallback.text.page * 0.5, 'a page that ends in text scrolls by most of a page: scrollTop ' + fallback.text.scrolled);
    check(fallback.virtual.scrolled >= 1 && fallback.virtual.scrolled <= fallback.virtual.page * 0.3,
        'a virtual list with no row left past the fold scrolls one row: scrollTop ' + fallback.virtual.scrolled);
    check(fallback.fromPicture === 'tvt-c1', 'two repeats on the picture move the focus once: ' + fallback.fromPicture);
    check(r.scope === 'document', 'a snack bar does not become the navigation scope: ' + r.scope);
    check(railScroll > 0, 'a smooth rail with nothing on screen to land on scrolls at once: scrollLeft ' + railScroll);
}
console.log('11. OK toggles native checkbox and radio controls once without submitting');
await page.evaluate(() => {
    document.body.innerHTML = `<form id="tv-checkbox-form">
        <label><input id="tv-checkbox" type="checkbox">Synthetic option</label>
        <input id="tv-radio-a" type="radio" name="synthetic-choice" checked>
        <input id="tv-radio-b" type="radio" name="synthetic-choice">
        <button id="tv-after-radio" type="button" style="display:block">Synthetic next action</button>
    </form>`;
    window.tvControlEvents = { changes: 0, submits: 0 };
    document.querySelector('#tv-checkbox').addEventListener('change', () => window.tvControlEvents.changes++);
    document.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.tvControlEvents.submits++;
    });
    document.querySelector('#tv-checkbox').focus();
});
await page.keyboard.press('Enter');
check(await page.locator('#tv-checkbox').isChecked(), 'OK selects a native checkbox');
await page.keyboard.press('Enter');
check(!(await page.locator('#tv-checkbox').isChecked()), 'OK clears a native checkbox');
check(await page.evaluate(() => window.tvControlEvents.changes === 2 && window.tvControlEvents.submits === 0),
    'one change per OK press and no form submission');
await page.locator('#tv-radio-b').focus();
await page.keyboard.press('Enter');
check(await page.locator('#tv-radio-b').isChecked() && !(await page.locator('#tv-radio-a').isChecked()),
    'OK selects a radio option and clears its peer');
await page.keyboard.press('ArrowDown');
check(await page.locator('#tv-after-radio').evaluate((button) => button === document.activeElement),
    'Down leaves a native radio group instead of trapping the remote');
check(await page.locator('#tv-radio-b').isChecked(), 'leaving the radio group keeps its selection');
console.log('12. visible trailer frames receive remote focus; hidden embeds stay excluded');
await page.evaluate(() => {
    document.body.innerHTML = `<div class="cdk-overlay-pane" style="position:fixed;left:0;top:0;width:640px;height:500px;flex-direction:column">
        <button id="synthetic-trailer-close" style="display:block;width:150px;height:40px">Close synthetic trailer</button>
        <iframe id="synthetic-trailer" title="Synthetic trailer" style="display:block;width:600px;height:400px"></iframe>
        <iframe id="synthetic-background" title="Synthetic background embed" hidden style="display:block;position:absolute;top:60px;left:0;width:600px;height:40px"></iframe>
    </div>`;
    const frame = document.querySelector('#synthetic-trailer');
    window.syntheticFrameArrows = 0;
    frame.contentDocument.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight') window.syntheticFrameArrows += 1;
    });
    document.querySelector('#synthetic-trailer-close').focus();
});
await key('ArrowDown');
check(await page.locator('#synthetic-trailer').evaluate((frame) => frame === document.activeElement),
    'Down enters the visible trailer frame');
await key('ArrowRight');
check(await page.evaluate(() => window.syntheticFrameArrows === 1),
    'keys inside the frame reach its player document');
await page.locator('#synthetic-trailer-close').focus();
await key('ArrowDown');
check(await page.evaluate(() => document.querySelector('#synthetic-background').getBoundingClientRect().width > 0 &&
    document.activeElement.id === 'synthetic-trailer'),
    'hidden background frames stay excluded even when CSS gives them visible geometry');
console.log('13. transparent playback-position inputs retain remote navigation and seeking');
await page.evaluate(() => {
    document.body.innerHTML = `<div class="cdk-overlay-pane" style="position:fixed;left:0;top:0;width:640px;height:240px;flex-direction:column">
        <button id="synthetic-before-seek" style="width:150px;height:40px">Synthetic control</button>
        <app-player-timeline>
            <div class="player-controls__timeline-bar" style="position:relative;width:600px;height:28px;margin-top:30px">
                <div class="player-controls__timeline-track" aria-hidden="true" style="width:600px;height:6px;background:#888"></div>
                <input id="synthetic-seek" class="player-controls__slider--timeline" type="range" min="0" max="100" value="50" style="position:absolute;inset:0;width:100%;height:100%;opacity:0">
            </div>
        </app-player-timeline>
    </div>`;
    document.querySelector('#synthetic-before-seek').focus();
});
await key('ArrowDown');
check(await page.locator('#synthetic-seek').evaluate((input) => document.activeElement === input),
    'Down reaches the transparent playback-position input');
check(await page.locator('.player-controls__timeline-track').evaluate((track) =>
    track.classList.contains('tv-focus') && getComputedStyle(track).outlineStyle === 'solid'),
    'the visible timeline track receives the remote focus ring');
await key('ArrowRight');
check(await page.locator('#synthetic-seek').inputValue() === '51', 'Right seeks through the native range input');
console.log('14. structural dashboard cards delegate remote focus to their links');
await page.evaluate(() => {
    document.body.innerHTML = `<div class="cdk-overlay-pane" style="position:fixed;left:0;top:0;width:640px;height:400px;flex-direction:column">
        <button id="synthetic-before-card" style="width:150px;height:40px">Synthetic control</button>
        <div id="synthetic-card" class="rail__card" role="listitem" style="width:200px;height:200px;margin-top:20px">
            <a id="synthetic-card-link" href="#synthetic-title" style="display:block;width:100%;height:100%">Synthetic title</a>
        </div>
    </div>`;
    window.syntheticCardActivations = 0;
    document.querySelector('#synthetic-card-link').addEventListener('click', (event) => {
        event.preventDefault(); window.syntheticCardActivations += 1;
    });
    document.querySelector('#synthetic-before-card').focus();
});
await key('ArrowDown');
check(await page.locator('#synthetic-card-link').evaluate((link) => document.activeElement === link),
    'Down selects the dashboard link rather than its structural list-item wrapper');
await key('Enter');
check(await page.evaluate(() => window.syntheticCardActivations === 1), 'OK activates the dashboard link once');
await page.evaluate(() => {
    const card = document.querySelector('#synthetic-card');
    card.setAttribute('tabindex', '-1');
    card.focus();
});
await key('ArrowDown');
check(await page.locator('#synthetic-card-link').evaluate((link) => document.activeElement === link),
    'a programmatic landing on a structural card enters its actionable child');
console.log('15. player-loading rollback precedes the first Angular render');
const buildDir = join(dirname(fileURLToPath(import.meta.url)), '../../dist/apps/web');
const selectors = ['app-art-player', 'app-vjs-player', 'app-html-video-player'];
const engineChunks = readdirSync(buildDir).filter((name) => {
    if (!name.endsWith('.js')) return false;
    const code = readFileSync(join(buildDir, name), 'utf8');
    return selectors.some((selector) => new RegExp('selectors:\\s*\\[\\[\\s*["\'`]' + selector + '["\'`]').test(code));
});
check(engineChunks.length > 0, 'the built PWA contains discoverable web-player engine chunks');
for (const eager of [false, true]) {
    const startupContext = await browser.newContext({ serviceWorkers: 'block' });
    await startupContext.addInitScript((eager) => {
        if (eager) localStorage.setItem('iptvnator.eagerPlayerLoading', '1');
        const observer = new MutationObserver(() => {
            if (document.querySelector('app-root')?.childElementCount) {
                window.__syntheticFirstRender = performance.now();
                observer.disconnect();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }, eager);
    const startupPage = await startupContext.newPage();
    await startupPage.goto(URL_, { waitUntil: 'networkidle' });
    await startupPage.waitForFunction(() => window.__syntheticFirstRender > 0);
    const loaded = await startupPage.evaluate(() => performance.getEntriesByType('resource')
        .filter((entry) => entry.responseEnd > 0 && entry.responseEnd <= window.__syntheticFirstRender)
        .map((entry) => new URL(entry.name).pathname.split('/').pop()));
    check(eager ? engineChunks.every((name) => loaded.includes(name)) : engineChunks.every((name) => !loaded.includes(name)),
        eager ? 'rollback loads every engine before Angular renders' : 'default startup renders before loading the engines');
    await startupContext.close();
}
console.log('16. backup export availability matches the runtime');
for (const shell of [true, false]) {
    for (const colorScheme of ['light', 'dark']) {
        const backupContext = await browser.newContext({ serviceWorkers: 'block', colorScheme });
        if (!shell) await backupContext.route('**/tvshell/tv.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
        const backupPage = await backupContext.newPage();
        await backupPage.goto(URL_ + '/workspace/settings/backup', { waitUntil: 'networkidle' });
        const section = backupPage.locator('app-settings-backup-section');
        const importButton = section.getByRole('button', { name: 'Import', exact: true });
        await importButton.waitFor({ state: 'visible' });
        check(await importButton.isEnabled(), `${shell ? 'TV shell' : 'browser'} ${colorScheme} keeps backup import available`);
        const exportButton = section.getByRole('button', { name: 'Export', exact: true });
        check((await exportButton.count()) === (shell ? 0 : 1), `${shell ? 'TV shell hides unsupported export' : 'browser retains export'} in ${colorScheme}`);
        if (!shell) {
            const pendingDownload = backupPage.waitForEvent('download');
            await exportButton.click();
            const download = await pendingDownload;
            const path = await download.path();
            check(await download.failure() === null && JSON.parse(readFileSync(path, 'utf8')).kind === 'iptvnator-playlist-backup',
                `browser ${colorScheme} export writes a valid backup file`);
        }
        await backupPage.screenshot({ path: join(SHOTS, `backup-${shell ? 'tv' : 'browser'}-${colorScheme}.png`), fullPage: true });
        await backupContext.close();
    }
}
console.log('17. fullscreen navigation excludes background controls and preserves nested overlays');
await page.evaluate(() => {
    document.body.innerHTML = `<button id="synthetic-fullscreen-enter" style="position:fixed;left:10px;top:10px;z-index:10">Open synthetic player</button>
        <div id="synthetic-fullscreen" style="position:fixed;inset:0;background:#111">
            <video id="synthetic-fullscreen-video" tabindex="0" style="position:absolute;left:100px;top:100px;width:320px;height:180px"></video>
            <button id="synthetic-fullscreen-control" style="position:absolute;left:240px;top:600px">Synthetic player action</button>
        </div>
        <button id="synthetic-fullscreen-behind" style="position:fixed;left:240px;top:240px">Synthetic background action</button>`;
    document.querySelector('#synthetic-fullscreen-enter').onclick = async () => {
        await document.querySelector('#synthetic-fullscreen').requestFullscreen();
        document.querySelector('video').focus();
    };
});
await page.locator('#synthetic-fullscreen-enter').click({ force: true });
await page.waitForFunction(() => document.fullscreenElement?.id === 'synthetic-fullscreen');
await key('ArrowDown');
check(await page.evaluate(() => document.activeElement.id === 'synthetic-fullscreen-control'),
    'Down from the fullscreen picture reaches a visible player control');
check(await page.evaluate(() => Array.from(document.querySelectorAll('.tv-focus')).every((element) => document.fullscreenElement.contains(element))),
    'fullscreen focus feedback stays inside the visible fullscreen owner');
await page.evaluate(() => {
    document.querySelector('#synthetic-fullscreen').insertAdjacentHTML('beforeend',
        `<div class="cdk-overlay-backdrop cdk-overlay-backdrop-showing"></div>
         <div class="cdk-overlay-pane" id="synthetic-fullscreen-menu" style="position:absolute;left:240px;top:350px">
             <div role="menu"><button id="synthetic-fullscreen-menu-action">Synthetic menu action</button></div>
         </div>`);
    document.body.insertAdjacentHTML('beforeend',
        `<div id="synthetic-background-menu" class="cdk-overlay-pane" style="position:fixed;left:240px;top:300px">
             <div role="menu"><button>Synthetic hidden menu action</button></div>
         </div>`);
    document.querySelector('video').focus();
});
await key('ArrowDown');
check(await page.evaluate(() => document.activeElement.id === 'synthetic-fullscreen-menu-action'),
    'fullscreen navigation honors its nested menu and ignores an outside overlay');
await page.evaluate(() => {
    const control = document.querySelector('#synthetic-fullscreen-control');
    control.focus();
    control.blur();
    document.querySelector('#synthetic-fullscreen-menu').remove();
    document.querySelector('.cdk-overlay-backdrop').remove();
    document.querySelector('#synthetic-background-menu').remove();
});
await page.waitForFunction(() => document.activeElement.id === 'synthetic-fullscreen-video', null, { timeout: 2000 });
await page.evaluate(async () => {
    await document.exitFullscreen();
    document.querySelector('video').focus();
});
await key('ArrowDown');
check(await page.evaluate(() => document.activeElement.id === 'synthetic-fullscreen-behind'),
    'leaving fullscreen restores navigation to the surrounding document');
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
await browser.close();

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
console.log('8. the stream handed to an external player is the playlist, never a fetched segment');
{
    // Same request pattern as hls.js / VHS: playlist as text, segments as arraybuffer.
    // The requests themselves may fail (CORS): the tracking happens at send().
    const tracked = await page.evaluate((provider) => {
        const get = (url, responseType) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            if (responseType) xhr.responseType = responseType;
            try { xhr.send(); } catch (e) { /* ignore */ }
        };
        get(provider + '/live/user/pass/7.m3u8');
        get(provider + '/hls/user/pass/7_000001.ts', 'arraybuffer');
        get(provider + '/hls/user/pass/7_000002.ts', 'arraybuffer');
        return window.__tvShell.state().lastMediaUrl;
    }, PROVIDER);
    check(tracked === PROVIDER + '/live/user/pass/7.m3u8', 'segments fetched after the playlist do not replace it: ' + tracked);
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
await browser.close();

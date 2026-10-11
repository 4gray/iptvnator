/**
 * Virtual-scroll channel list: Down must keep moving through 180 channels,
 * and the player controls must be reachable from the picture.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.text().startsWith('[tvshell] bridge')) console.log('  ' + m.text()); });
let failures = 0;
const check = (c, m) => { if (!c) failures++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

await page.goto('http://127.0.0.1:43330/workspace/sources', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Add M3U/i }).click();
await page.waitForTimeout(600);
const dialog = page.locator('mat-dialog-container');
await dialog.locator('input').nth(0).fill('http://127.0.0.1:43331/sample.m3u');
await dialog.getByRole('button', { name: /Add playlist/i }).click();
await page.waitForTimeout(2500);

const focused = () => page.evaluate(() => window.__tvShell.state().active);
async function key(k, n = 1, delay = 130) { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(delay); } return focused(); }

console.log('1. walk down the channel list');
// Get onto a channel row (explore the focus graph with the D-pad).
async function reach(re, keys = ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], max = 60) {
    const tried = new Map();
    for (let i = 0; i < max; i++) {
        const f = await focused();
        if (f && re.test(f)) return f;
        const done = tried.get(f) || new Set();
        const next = keys.find((k) => !done.has(k)) || keys[i % keys.length];
        done.add(next);
        tried.set(f, done);
        await key(next);
    }
    return null;
}
let f = await focused();
console.log('  initial focus:', f);
f = await reach(/button\.channel-content/);
check(/channel-content/.test(f || ''), 'on a channel row: ' + f);
const numbers = [];
for (let i = 0; i < 70; i++) {
    f = await key('ArrowDown', 1, 140);
    const m = /\[(\d+)\./.exec(f || '');
    numbers.push(m ? Number(m[1]) : null);
}
const last = numbers.filter((n) => n !== null).pop();
console.log('  channel numbers visited:', numbers.filter((n, i) => i % 7 === 0).join(', '), '… last =', last);
check(last >= 60, 'Down scrolled through the virtual list past channel 60 (reached ' + last + ')');
const distinct = new Set(numbers.filter((n) => n !== null));
check(distinct.size >= 55, `${distinct.size} distinct channels reached in 70 presses`);
await page.screenshot({ path: 'tests/shots/longlist-down.png' });

console.log('2. walk back up');
for (let i = 0; i < 30; i++) f = await key('ArrowUp', 1, 120);
console.log('  after 30 Up:', f);
check(/channel-content/.test(f || ''), 'still on a channel row after Up');

console.log('3. play a channel, reach the player and its controls');
await key('Enter');
await page.waitForTimeout(2000);
const path = [];
for (let i = 0; i < 4; i++) path.push(((await key('ArrowRight')) || '∅').slice(0, 70));
console.log('  Right ×4:\n    ' + path.join('\n    '));
f = await focused();
const onVideo = /^video/.test(f || '');
check(onVideo, 'picture reachable with Right: ' + f);
if (onVideo) {
    const down = [];
    for (let i = 0; i < 3; i++) down.push(((await key('ArrowDown', 1, 300)) || '∅').slice(0, 80));
    console.log('  Down ×3 from the picture:\n    ' + down.join('\n    '));
    check(down.some((d) => /button/.test(d)), 'buttons reachable below the picture');
    f = await reach(/^video/, ['ArrowRight', 'ArrowUp']);
    const up = [];
    for (let i = 0; i < 3; i++) up.push(((await key('ArrowUp', 1, 300)) || '∅').slice(0, 80));
    console.log('  Up ×3 from the picture:\n    ' + up.join('\n    '));
    check(up.some((d) => /Copy stream URL|Copy diagnostics|Technical details/i.test(d)), 'the player error overlay actions are reachable');
    f = await reach(/Copy stream URL/i, ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    await key('Enter');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/shots/longlist-controls.png' });
}
console.log('4. external player prompt after the unsupported .ts source');
console.log('  state:', await page.evaluate(() => window.__tvShell.state()));
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
await browser.close();

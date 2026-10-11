import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const reqs = [];
page.on('request', (r) => { if (r.url().includes(':43331')) reqs.push(r.method() + ' ' + r.url()); });
page.on('console', (m) => { if (m.text().startsWith('[tvshell]')) console.log('  ' + m.text()); });

// Add an M3U playlist through the UI (pointer, we test the player part here).
await page.goto('http://127.0.0.1:43330/workspace/sources', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Add M3U/i }).click();
await page.waitForTimeout(800);
await page.getByRole('radio', { name: /public M3U URL/i }).click().catch(() => {});
await page.waitForTimeout(300);
const dialog = page.locator('mat-dialog-container');
await dialog.locator('input').nth(0).fill('http://127.0.0.1:43331/sample.m3u');
await dialog.locator('input').nth(1).fill('Mock M3U');
await page.screenshot({ path: 'tests/shots/m3u-form.png' });
await dialog.getByRole('button', { name: /Add playlist/i }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tests/shots/m3u-added.png' });
console.log('url after add:', page.url());
console.log('requests:', reqs);

// Now use the D-pad to reach a channel and play it.
const focused = () => page.evaluate(() => window.__tvShell.state().active);
async function key(k, n = 1) { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(150); } return focused(); }
console.log('focused:', await focused());
for (let i = 0; i < 40; i++) {
    const f = await focused();
    if (f && /News 1|Channel|News \d|Sports \d/i.test(f) && /button|card|option|listitem/i.test(f)) break;
    await key(['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowRight'][i % 4]);
}
console.log('reached:', await focused());
reqs.length = 0;
await key('Enter');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/shots/m3u-playing.png' });
console.log('after Enter:', await page.evaluate(() => window.__tvShell.state()));
console.log('videos:', await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ src: v.getAttribute('src'), currentSrc: v.currentSrc, paused: v.paused, readyState: v.readyState, w: v.getBoundingClientRect().width }))));
console.log('media requests:', reqs.slice(0, 8));
console.log('currentStreamUrl:', await page.evaluate(() => window.__tvShell.currentStreamUrl()));
// Keyboard: can we reach the video and the player controls?
const walk = [];
for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown']) walk.push((await key(k)) || '∅');
console.log('walk:\n  ' + walk.map((w) => w.slice(0, 90)).join('\n  '));
console.log('menu →', await page.evaluate(() => window.__tvShell.menu()), await page.evaluate(() => window.__tvShell.state()));
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/shots/m3u-menu.png' });
await browser.close();

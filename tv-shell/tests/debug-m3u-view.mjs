import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:43330/workspace/sources', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Add M3U/i }).click();
await page.waitForTimeout(600);
const dialog = page.locator('mat-dialog-container');
await dialog.locator('input').nth(0).fill('http://127.0.0.1:43331/sample.m3u');
await dialog.getByRole('button', { name: /Add playlist/i }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/shots/m3u-view.png' });
console.log('url:', page.url());
console.log('focused:', await page.evaluate(() => window.__tvShell.state().active));
const cands = await page.evaluate(() => {
    const sel = 'a[href],button,input,select,textarea,[tabindex],[role="button"],[role="option"],[role="listitem"],video,.mat-mdc-list-item,mat-card';
    return [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 720 && r.left < 1280; })
        .slice(0, 60).map((el) => { const r = el.getBoundingClientRect(); return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.')} [${el.getAttribute('aria-label') || ''}] "${(el.textContent || '').trim().slice(0, 20)}" @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ti=${el.getAttribute('tabindex')}`; });
});
console.log(cands.join('\n'));
await browser.close();

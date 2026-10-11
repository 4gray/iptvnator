import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.text().startsWith('[tvshell]')) console.log('  ' + m.text()); });
await page.goto('http://127.0.0.1:43330/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// Sources page → Add Xtream
await page.goto('http://127.0.0.1:43330/workspace/sources', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Add Xtream/i }).click();
await page.waitForTimeout(900);
console.log('dialog state:', await page.evaluate(() => window.__tvShell.state()));
const info = await page.evaluate(() => {
    const active = document.activeElement;
    const pane = active.closest('.cdk-overlay-pane');
    const r = active.getBoundingClientRect();
    const list = [...pane.querySelectorAll('button,input,[tabindex],[role]')].map((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), text: (el.textContent || '').trim().slice(0, 25), rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], vis: cs.visibility, pe: cs.pointerEvents, op: cs.opacity, tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), disabled: el.disabled, ariaHidden: !!el.closest('[aria-hidden="true"]') };
    });
    return { active: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], paneAriaHidden: !!pane.closest('[aria-hidden="true"]'), count: list.length, list: list.slice(0, 30) };
});
console.log(JSON.stringify(info, null, 1));
console.log('move down →', await page.evaluate(() => window.__tvShell.move('down')), await page.evaluate(() => window.__tvShell.state().active));
console.log('move right →', await page.evaluate(() => window.__tvShell.move('right')), await page.evaluate(() => window.__tvShell.state().active));
await browser.close();

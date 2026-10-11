import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.text().startsWith('[tvshell]')) console.log('  ' + m.text()); });
await page.goto('http://127.0.0.1:43330/workspace/sources', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Add M3U/i }).click();
await page.waitForTimeout(600);
const dialog = page.locator('mat-dialog-container');
await dialog.locator('input').nth(0).fill('http://127.0.0.1:43331/sample.m3u');
await dialog.getByRole('button', { name: /Add playlist/i }).click();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Sports 3/ }).first().click();
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => {
    const root = document.querySelector('.video-js');
    const player = root && (root.player || (root.parentElement && root.parentElement.player));
    const out = { hasRoot: !!root, hasPlayer: !!player, keys: root ? Object.keys(root).filter((k) => !k.startsWith('__')).slice(0, 10) : [] };
    if (player) {
        out.currentSrc = player.currentSrc && player.currentSrc();
        out.cacheSources = player.cache_ && player.cache_.sources;
        out.cacheSource = player.cache_ && player.cache_.source;
        out.error = player.error && player.error() && player.error().code;
    }
    out.videos = [...document.querySelectorAll('video')].map((v) => ({ id: v.id, src: v.getAttribute('src'), cur: v.currentSrc, keys: Object.keys(v).slice(0, 8) }));
    out.artplayer = !!document.querySelector('.art-video-player');
    return out;
}));
console.log('currentStreamUrl:', await page.evaluate(() => window.__tvShell.currentStreamUrl()));
console.log('state:', await page.evaluate(() => window.__tvShell.state()));
await browser.close();

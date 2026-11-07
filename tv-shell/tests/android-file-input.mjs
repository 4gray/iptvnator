/** Native smoke test: install a debug APK on an emulator first, then:
 * ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-file-input.mjs emulator-5554
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _android } from '@playwright/test';

const serial = process.argv[2];
assert.ok(serial?.startsWith('emulator-'), 'An explicit emulator serial is required; physical devices are excluded.');
assert.ok(process.env.ANDROID_HOME, 'Set ANDROID_HOME to the Android SDK.');
const adb = (...args) => execFileSync(join(process.env.ANDROID_HOME, 'platform-tools/adb'), ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
const resumed = () => adb('shell', 'dumpsys', 'activity', 'activities').split('\n').find((line) => line.includes('topResumedActivity=')) || '';
async function waitFor(check, message) {
    for (let attempt = 0; attempt < 30; attempt++) {
        if (check()) return;
        await delay(200);
    }
    assert.fail(message);
}
function tap(label) {
    adb('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/iptvnator-picker-test.xml');
    const xml = adb('exec-out', 'cat', '/sdcard/iptvnator-picker-test.xml');
    const node = (xml.match(/<node\b[^>]+>/g) || []).find((node) => node.includes(`text="${label}"`) || node.includes(`content-desc="${label}"`));
    assert.ok(node, `Native picker action missing: ${label}`);
    const [, x1, y1, x2, y2] = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    adb('shell', 'input', 'tap', String((+x1 + +x2) / 2), String((+y1 + +y2) / 2));
}

const temp = mkdtempSync(join(tmpdir(), 'iptvnator-picker-'));
let device;
try {
    adb('shell', 'am', 'start', '-n', 'org.tvshell.iptvnator/.ui.MainActivity');
    device = (await _android.devices({ omitDriverInstall: true })).find((device) => device.serial() === serial);
    assert.ok(device, 'Emulator was not found by Playwright.');
    const page = await (await device.webView({ pkg: 'org.tvshell.iptvnator' })).page();
    await page.waitForLoadState('domcontentloaded');
    async function open(accept) {
        await page.evaluate((accept) => {
            document.getElementById('synthetic-file-input')?.remove();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = accept;
            input.id = 'synthetic-file-input';
            input.style.cssText = 'position:fixed;top:10px;left:10px;z-index:2147483647';
            window.__syntheticFileResult = null;
            input.onchange = async () => { window.__syntheticFileResult = await input.files[0].text(); };
            document.body.append(input);
        }, accept);
        await page.locator('#synthetic-file-input').click();
        await waitFor(() => /documentsui/.test(resumed()), 'HTML input did not open the native document picker.');
    }
    for (const [extension, accept, content] of [
        ['m3u', '.m3u,.m3u8', '#EXTM3U\n#EXTINF:-1,Synthetic Channel\nhttps://stream.example/live.m3u8\n'],
        ['json', '.json,application/json', '{"synthetic":true}'],
    ]) {
        const name = `iptvnator-synthetic.${extension}`;
        writeFileSync(join(temp, name), content);
        adb('push', join(temp, name), `/sdcard/Download/${name}`);
        await open(accept);
        tap('Show roots');
        tap('Downloads');
        tap(name);
        await waitFor(() => /org\.tvshell\.iptvnator/.test(resumed()), 'Picker did not return to the app.');
        await page.waitForFunction(() => window.__syntheticFileResult !== null);
        assert.equal(await page.evaluate(() => window.__syntheticFileResult), content);
        console.log(`PASS native ${extension} selection reaches the HTML file reader`);
    }
    await open('.json');
    adb('shell', 'input', 'keyevent', '4');
    await waitFor(() => /org\.tvshell\.iptvnator/.test(resumed()), 'Cancel did not return to the app.');
    assert.equal(await page.locator('#synthetic-file-input').evaluate((input) => input.files.length), 0);
    await open('.json');
    adb('shell', 'input', 'keyevent', '4');
    console.log('PASS cancellation clears the pending callback and allows another picker');
} finally {
    await device?.close();
    adb('shell', 'rm', '-f', '/sdcard/Download/iptvnator-synthetic.m3u', '/sdcard/Download/iptvnator-synthetic.json', '/sdcard/iptvnator-picker-test.xml');
    rmSync(temp, { recursive: true, force: true });
}

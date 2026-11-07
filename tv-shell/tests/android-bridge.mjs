/** Requires a debug APK on a test emulator.
 * ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-bridge.mjs emulator-5554
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _android } from '@playwright/test';

const serial = process.argv[2];
assert.ok(serial?.startsWith('emulator-') && process.env.ANDROID_HOME, 'Set ANDROID_HOME and pass an emulator serial.');
const adb = (...args) => execFileSync(join(process.env.ANDROID_HOME, 'platform-tools/adb'), ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
const activity = () => adb('shell', 'dumpsys', 'activity', 'activities').split('\n').find((line) => line.includes('topResumedActivity')) || '';
const device = (await _android.devices({ omitDriverInstall: true })).find((value) => value.serial() === serial);
assert.ok(device, 'Emulator was not found.');
try {
    adb('shell', 'am', 'start', '-n', 'org.tvshell.iptvnator/.ui.MainActivity');
    const page = await (await device.webView({ pkg: 'org.tvshell.iptvnator' })).page();
    await page.waitForFunction(() => window.__tvShell && !document.getElementById('initial-splash'));
    await page.evaluate(() => {
        const opaque = document.createElement('iframe');
        opaque.id = 'synthetic-cross-origin';
        opaque.setAttribute('sandbox', 'allow-scripts');
        opaque.srcdoc = '<p>Synthetic external frame</p>';
        const local = document.createElement('iframe');
        local.id = 'synthetic-same-origin';
        local.srcdoc = '<p>Synthetic local frame</p>';
        document.body.append(opaque, local);
    });
    const crossOrigin = await (await page.locator('#synthetic-cross-origin').elementHandle()).contentFrame();
    await crossOrigin.waitForURL('about:srcdoc');
    assert.equal(await crossOrigin.evaluate(() => typeof window.TvShell), 'undefined', 'Cross-origin frames must not receive the bridge.');
    const sameOrigin = await (await page.locator('#synthetic-same-origin').elementHandle()).contentFrame();
    await sameOrigin.waitForURL('about:srcdoc');
    assert.equal(await sameOrigin.evaluate(() => window.origin), await page.evaluate(() => window.origin));
    await sameOrigin.evaluate(() => window.TvShell.postMessage('["openSettings"]'));
    await delay(300);
    assert.match(activity(), /\.ui\.MainActivity/, 'Same-origin child messages must be ignored.');
    await page.evaluate(() => {
        window.TvShell.postMessage(String.raw`["\uZZZZ"]`);
        window.TvShell.postMessage('["openSettings"]');
    });
    for (let attempt = 0; attempt < 30 && !activity().includes('.ui.SettingsActivity'); attempt++) await delay(100);
    assert.match(activity(), /\.ui\.SettingsActivity/, 'The trusted main frame must reach native settings.');
    adb('shell', 'input', 'keyevent', '4');
    console.log('PASS bridge is restricted to the trusted main frame');
} finally {
    await device.close();
}

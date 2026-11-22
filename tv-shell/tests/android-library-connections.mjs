// Use a disposable English-language emulator with the debug APK installed.
// ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-library-connections.mjs emulator-5556 hosted
// For "nas" start two stock Docker containers on 127.0.0.1:43451/43452, open/token respectively.
// Seed each with a single source titled "Synthetic open NAS"/"Synthetic token NAS" and use
// the test token "synthetic-nas-secret". The hosted test starts two isolated Electron workers.
// Both scenarios begin in the local library. Neither clears emulator data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron, chromium, expect } from '@playwright/test';

const [serial, scenario] = process.argv.slice(2);
assert.match(
    serial ?? '',
    /^emulator-\d+$/,
    'Pass the disposable emulator serial.'
);
assert.ok(['nas', 'hosted'].includes(scenario) && process.env.ANDROID_HOME);
const adb = (...args) =>
    execFileSync(
        join(process.env.ANDROID_HOME, 'platform-tools/adb'),
        ['-s', serial, ...args],
        {
            encoding: 'utf8',
            timeout: 90000,
        }
    ).trim();
const pkg = 'org.tvshell.iptvnator';
const origin = (port) => 'http://127.0.0.1:' + port;
const ports = scenario === 'hosted' ? [43453, 43454] : [43451, 43452];
const profile = mkdtempSync(join(tmpdir(), 'iptvnator-android-fixture-'));
const timeout = 90000;
let desktop, browser, page, forward;
const reversed = [];
const field = (id) => page.locator('[data-test-id="' + id + '"]');

async function attach() {
    adb('shell', 'am', 'start', '-n', pkg + '/.ui.MainActivity');
    const appPid = () => adb('shell', 'pidof', pkg);
    await expect
        .poll(
            () => {
                try {
                    return appPid();
                } catch {
                    return '';
                }
            },
            { timeout }
        )
        .toMatch(/^\d+$/);
    forward = adb(
        'forward',
        'tcp:0',
        'localabstract:webview_devtools_remote_' + appPid()
    );
    await expect
        .poll(
            async () => {
                try {
                    return (
                        await fetch(origin(forward) + '/json/list', {
                            signal: AbortSignal.timeout(3000),
                        })
                    ).ok;
                } catch {
                    return false;
                }
            },
            { timeout }
        )
        .toBe(true);
    browser = await chromium.connectOverCDP(
        'ws://127.0.0.1:' + forward + '/devtools/browser',
        { timeout, noDefaults: true, isWebView: true }
    );
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(timeout);
    await page.waitForFunction(() => !!window.__tvShellLibraryConnection);
}
async function detach() {
    await browser?.close().catch(() => {});
    browser = undefined;
    if (forward) adb('forward', '--remove', 'tcp:' + forward);
    forward = undefined;
}
async function select(port) {
    await page.goto(new URL('/workspace/settings/server', page.url()).href);
    await field('source-server-url').fill(origin(port));
    await field('source-server-connect').click();
}
async function nativeDialog(pattern) {
    let xml;
    await expect
        .poll(
            () => {
                xml = adb(
                    'exec-out',
                    'uiautomator',
                    'dump',
                    '--compressed',
                    '/dev/tty'
                );
                return pattern.test(xml);
            },
            { timeout, intervals: [250] }
        )
        .toBe(true);
    return xml;
}
function tap(xml, attribute) {
    const node = (xml.match(/<node\b[^>]+>/g) ?? []).find((tag) =>
        attribute.test(tag)
    );
    assert.ok(node, 'Missing native control ' + attribute);
    const [, x1, y1, x2, y2] = node
        .match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
        .map(Number);
    adb(
        'shell',
        'input',
        'tap',
        String(Math.floor((x1 + x2) / 2)),
        String(Math.floor((y1 + y2) / 2))
    );
}
async function confirm(port, token, action = 'Continue') {
    let xml = await nativeDialog(/resource-id="android:id\/button1"/);
    assert.ok(
        xml.includes(origin(port)),
        'Confirmation must identify the destination'
    );
    if (xml.includes('text="Check server"')) {
        tap(xml, /resource-id="android:id\/button1"/);
        xml = await nativeDialog(
            /text="(?:Library connection|Register this Android device)"/
        );
        assert.ok(
            xml.includes(origin(port)),
            'Connection dialog must identify the destination'
        );
    }
    if (token) {
        tap(xml, /class="android.widget.EditText"/);
        adb('shell', 'input', 'text', token);
        adb('shell', 'input', 'keyevent', '4');
        xml = await nativeDialog(/resource-id="android:id\/button1"/);
    }
    tap(
        xml,
        action === 'Continue'
            ? /resource-id="android:id\/button1"/
            : /resource-id="android:id\/button2"/
    );
}
async function inventory(port, title) {
    await page.waitForFunction(
        (expected) => window.__tvShellLibraryConnection?.origin === expected,
        origin(port),
        { timeout }
    );
    await page.goto(new URL('/workspace/sources', page.url()).href);
    const row = page.locator('app-source-row').filter({ hasText: title });
    await expect(row).toBeVisible({ timeout });
    await expect(page.locator('app-source-row')).toHaveCount(1, { timeout });
}
async function coldStart(port, title) {
    await detach();
    adb('shell', 'am', 'force-stop', pkg);
    await attach();
    await inventory(port, title);
}
try {
    if (scenario === 'hosted') {
        const assets = resolve(
            process.env.ANDROID_FIXTURE_ASSETS || 'dist/apps/web'
        );
        assert.ok(
            existsSync(join(assets, 'index.html')),
            'Build the current PWA before starting the hosted servers.'
        );
        desktop = await _electron.launch({
            args: [
                '--user-data-dir=' + profile,
                resolve('tv-shell/tests/android-library-hosts.cjs'),
            ],
            env: {
                ...process.env,
                ANDROID_FIXTURE_ASSETS: assets,
                ANDROID_FIXTURE_HOSTS: JSON.stringify([
                    ['A', ports[0]],
                    ['B', ports[1]],
                ]),
            },
            timeout,
        });
        await expect
            .poll(() => desktop.evaluate(() => !!globalThis.androidFixture), {
                timeout,
            })
            .toBe(true);
    }
    for (const port of ports) {
        adb('reverse', 'tcp:' + port, 'tcp:' + port);
        reversed.push(port);
    }
    await attach();
    assert.equal(
        await page.evaluate(() => window.__tvShellLibraryConnection.origin),
        '',
        'Start in the local library.'
    );
    if (scenario === 'hosted') {
        for (const [index, label] of ['A', 'B'].entries()) {
            const port = ports[index];
            assert.equal(
                (await fetch(origin(port) + '/api/v1/sources')).status,
                401
            );
            await select(port);
            await confirm(port);
            const xml = await nativeDialog(/Confirmation code: \d{6}/);
            const code = xml.match(/Confirmation code: (\d{6})/)[1];
            assert.equal(
                await desktop.evaluate(
                    (_electron, args) =>
                        globalThis.androidFixture.approve(...args),
                    [label, code]
                ),
                204
            );
            await inventory(port, 'Synthetic hosted ' + label);
            console.log(
                'PASS Paired hosted library ' +
                    label +
                    ' renders its protected source'
            );
        }
        await coldStart(ports[1], 'Synthetic hosted B');
        await select(ports[0]);
        await confirm(ports[0]);
        await inventory(ports[0], 'Synthetic hosted A');
        console.log(
            'PASS Cold start restores B and switching back reuses the approved A credential'
        );
    } else {
        await select(ports[0]);
        await confirm(ports[0]);
        await inventory(ports[0], 'Synthetic open NAS');
        assert.match(new URL(page.url()).hostname, /\.iptvnator\.localhost$/);
        console.log(
            'PASS Stock open NAS registry renders a source in the bundled WebView'
        );
        await select(ports[1]);
        await confirm(ports[1], undefined, 'Cancel');
        await inventory(ports[0], 'Synthetic open NAS');
        await select(ports[1]);
        await confirm(ports[1], 'incorrect-synthetic-token');
        const error = await nativeDialog(/requires authentication/);
        tap(error, /resource-id="android:id\/button1"/);
        await inventory(ports[0], 'Synthetic open NAS');
        await select(ports[1]);
        await confirm(ports[1], 'synthetic-nas-secret');
        await inventory(ports[1], 'Synthetic token NAS');
        await coldStart(ports[1], 'Synthetic token NAS');
        console.log(
            'PASS Cancel and rejected token retain the open NAS, valid token opens the protected source and survives cold start'
        );
    }
} finally {
    await detach();
    for (const port of reversed) adb('reverse', '--remove', 'tcp:' + port);
    await desktop?.close();
    rmSync(profile, { recursive: true, force: true });
}

/** Native regression: pair a debug APK to a synthetic loopback hosted server first.
 * Keep the server running and reverse its port with ADB. Then run:
 * ANDROID_HOME=/path/to/sdk node tv-shell/tests/android-hosted-reconnect.mjs emulator-5556 http://127.0.0.1:43340
 * This switches libraries on the named emulator; it never clears app data or pairing.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [serial, origin] = process.argv.slice(2);
assert.ok(serial?.startsWith('emulator-') && process.env.ANDROID_HOME, 'Set ANDROID_HOME and pass an emulator serial.');
const address = new URL(origin);
assert.equal(address.origin, origin);
assert.equal(address.protocol, 'http:');
assert.equal(address.hostname, '127.0.0.1', 'Use a synthetic loopback fixture, never a provider or production server.');
const adb = (...args) => execFileSync(join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
    ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 });
const pkg = 'org.tvshell.iptvnator';
const pid = adb('shell', 'pidof', pkg).trim();
const port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`).trim();
let ws;
try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(value => value.type === 'page');
    assert.ok(target, 'Launch the debug APK first.');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
        const reply = JSON.parse(data);
        const request = pending.get(reply.id);
        if (!request) return;
        pending.delete(reply.id);
        clearTimeout(request.timer);
        reply.error ? request.reject(new Error(reply.error.message)) : request.resolve(reply.result);
    };
    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
            pending.set(id, { resolve, reject, timer });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    }
    async function waitFor(expression, message) {
        for (let attempt = 0; attempt < 50; attempt++) {
            try { if (await evaluate(expression)) return; } catch { /* Navigation can replace the execution context. */ }
            await delay(200);
        }
        assert.fail(message);
    }
    function tap(label) {
        adb('shell', 'uiautomator', 'dump', '/sdcard/iptvnator-reconnect-test.xml');
        const xml = adb('shell', 'cat', '/sdcard/iptvnator-reconnect-test.xml');
        const node = (xml.match(/<node\b[^>]+>/g) ?? []).find(value => value.toLowerCase().includes(`text="${label.toLowerCase()}"`));
        assert.ok(node, `Native action missing: ${label}`);
        const [x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
        adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
    }
    const selected = await evaluate('window.__tvShellLibraryConnection');
    assert.equal(selected?.savedOrigin, origin, 'Start with the paired synthetic hosted library.');
    assert.equal(selected.paired, true);
    await evaluate('location.href = "/workspace/settings/server"; true');
    const disconnect = '[data-test-id="android-library-disconnect"]';
    if (selected.origin) {
        assert.equal(selected.origin, origin);
        await waitFor(`!!document.querySelector(${JSON.stringify(disconnect)})`, 'Hosted Connectivity did not load.');
        await evaluate(`document.querySelector(${JSON.stringify(disconnect)}).click(); true`);
    }
    const reconnect = '[data-test-id="android-library-reconnect"]';
    await waitFor(`!!document.querySelector(${JSON.stringify(reconnect)})`, 'Disconnect did not open local Connectivity.');
    const local = await evaluate('window.__tvShellLibraryConnection');
    assert.equal(local.origin, '');
    assert.equal(local.savedOrigin, origin);
    assert.equal(local.paired, true, 'Disconnect must preserve the device credential.');
    console.log('PASS Local library keeps the saved server and pairing');
    await evaluate(`document.querySelector(${JSON.stringify(reconnect)}).click(); true`);
    tap('Continue');
    await waitFor(`location.origin === ${JSON.stringify(origin)} && !!document.querySelector(${JSON.stringify(disconnect)})`,
        'Reconnect rejected an already paired server or failed to restore hosted Connectivity.');
    assert.equal(await evaluate('window.__tvShellLibraryConnection.paired'), true);
    await evaluate('location.href = "/workspace/dashboard"; true');
    const syntheticSource = 'a[href="/workspace/playlists/synthetic-android-source"]';
    await waitFor(`!!document.querySelector(${JSON.stringify(syntheticSource)})`,
        'Paired server did not return the synthetic library without another access code.');
    console.log('PASS Reconnect restores the authenticated synthetic library without pairing again');
    const settings = 'a[href="/workspace/settings"]';
    await evaluate(`document.querySelector(${JSON.stringify(settings)}).click(); true`);
    await waitFor('location.pathname === "/workspace/settings/general"', 'Settings did not open.');
    const dashboard = 'a[href="/workspace/dashboard"]';
    await evaluate(`document.querySelector(${JSON.stringify(dashboard)}).click(); true`);
    await waitFor(`!!document.querySelector(${JSON.stringify(syntheticSource)})`, 'Dashboard did not reopen.');
    await evaluate(`document.querySelector(${JSON.stringify(syntheticSource)}).click(); true`);
    const channel = 'button';
    const channelReady = `[...document.querySelectorAll(${JSON.stringify(channel)})].some(button => button.innerText.includes('1. Synthetic playable clip'))`;
    await waitFor(channelReady, 'Returning from Settings left the channel sidebar on its loading placeholder.');
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.innerText.includes('1. Synthetic playable clip')).click(); true`);
    await waitFor('document.querySelector("video")?.readyState >= 3 && !document.querySelector("video").paused',
        'The synthetic channel did not start playback after returning from Settings.');
    const video = await evaluate('({time:document.querySelector("video").currentTime,frames:document.querySelector("video").getVideoPlaybackQuality().totalVideoFrames})');
    await waitFor(`document.querySelector('video').currentTime > ${video.time + 1} && document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames > ${video.frames}`,
        'Playback did not advance or decode frames.');
    console.log('PASS Settings navigation restores channel selection and decoded playback');
} finally {
    ws?.close();
    adb('forward', '--remove', `tcp:${port}`);
}

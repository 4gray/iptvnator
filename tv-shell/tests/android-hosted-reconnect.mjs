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
    let pausedNavigation;
    let authenticatedInventory = false;
    ws.onmessage = ({ data }) => {
        const reply = JSON.parse(data);
        if (reply.method === 'Fetch.requestPaused') {
            pausedNavigation?.(reply.params.requestId);
        }
        if (reply.method === 'Network.responseReceived') {
            const response = reply.params.response;
            if (response.url === origin + '/api/v1/sources' && [200, 304].includes(response.status)) {
                authenticatedInventory = true;
            }
        }
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
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    }
    async function waitFor(expression, message) {
        for (let attempt = 0; attempt < 50; attempt++) {
            try { if (await evaluate(`!!(${expression})`)) return; } catch { /* Navigation can replace the execution context. */ }
            await delay(200);
        }
        assert.fail(message);
    }
    function tap(label) {
        const xml = adb('exec-out', 'uiautomator', 'dump', '--compressed', '/dev/tty');
        const node = (xml.match(/<node\b[^>]+>/g) ?? []).find(value => value.toLowerCase().includes(`text="${label.toLowerCase()}"`));
        assert.ok(node, `Native action missing: ${label}`);
        const [x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
        adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
    }
    const disconnect = '[data-test-id="android-library-disconnect"]';
    const reconnect = '[data-test-id="android-library-reconnect"]';
    const options = '.android-connection-options';
    const server = JSON.stringify(origin);
    const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
    const connection = 'window.__tvShellLibraryConnection';
    async function restoreHosted(action) {
        authenticatedInventory = false;
        await evaluate(`${action}.click(); true`);
        tap('Continue');
        await waitFor(`${connection}?.origin === ${server} && ${connection}.paired && ${element(disconnect)}`,
            'The previously paired server did not reopen in hosted Connectivity.');
        for (let attempt = 0; !authenticatedInventory && attempt < 50; attempt++) await delay(200);
        assert.ok(authenticatedInventory, 'The hosted library did not load a protected source inventory.');
    }
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const selected = await evaluate(connection);
    assert.equal(selected?.origin, origin, 'Start with the paired synthetic hosted library selected.');
    assert.equal(selected.paired, true);
    assert.equal(await evaluate("fetch('/api/v1/sources', { credentials: 'omit', cache: 'no-store' }).then(response => response.status)"),
        401, 'Use a paired-only fixture that requires device credentials to read sources.');
    await evaluate('location.href = "/workspace/settings/server"; true');
    await waitFor(element(disconnect), 'Hosted Connectivity did not load.');
    await evaluate(`${element(disconnect)}.click(); true`);
    await waitFor(`${connection}?.origin === '' && ${element(options)}`, 'Disconnect did not open local Connectivity.');
    const local = await evaluate(connection);
    assert.equal(local.savedOrigin, '');
    assert.equal(local.offline, false);
    assert.equal(local.paired, false, 'Local mode has no selected device credential.');
    assert.equal(await evaluate(`!!${element(reconnect)}`), false);
    await evaluate(`
        const options = ${element(options)};
        options.open = true;
        const address = options.querySelector('input[type="url"]');
        address.value = ${server};
        address.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    const manualConnect = `[...${element(options)}.querySelectorAll('button')].find(
        button => button.textContent.trim() === 'Connect with access code' && !button.disabled)`;
    await waitFor(manualConnect, 'Connection options did not accept the server address.');
    await restoreHosted(manualConnect);
    console.log('PASS Re-entering the address after Disconnect restores the authenticated library');

    // A main-frame 503 exercises the WebView's native offline fallback. The host remains available for reconnect.
    const offlineUrl = origin + '/workspace/settings/server?synthetic-offline=1';
    await send('Fetch.enable', { patterns: [{ urlPattern: offlineUrl, resourceType: 'Document' }] });
    let pauseTimer;
    try {
        const pause = new Promise((resolve, reject) => {
            pausedNavigation = resolve;
            pauseTimer = setTimeout(() => reject(new Error('The fixture navigation was not intercepted.')), 10000);
        });
        const [requestId] = await Promise.all([pause, evaluate(`setTimeout(() => location.assign(${JSON.stringify(offlineUrl)})); true`)]);
        await send('Fetch.fulfillRequest', { requestId, responseCode: 503, responsePhrase: 'Service Unavailable' });
        await waitFor(`${connection}?.offline && ${element(reconnect)}`, 'The unavailable server did not open offline Connectivity.');
    } finally {
        clearTimeout(pauseTimer);
        pausedNavigation = undefined;
        await send('Fetch.disable');
    }
    const offline = await evaluate(connection);
    assert.equal(offline.origin, '');
    assert.equal(offline.savedOrigin, origin);
    assert.equal(offline.paired, true);
    await restoreHosted(element(reconnect));
    console.log('PASS Offline fallback retains the saved server and Connect restores the authenticated library');

    const sources = 'a[href="/workspace/sources"]';
    const source = 'app-source-row [role="button"][aria-label="Synthetic Android library"]';
    await evaluate(`${element(sources)}.click(); true`);
    await waitFor(element(source), 'The paired server did not return the synthetic source.');
    await evaluate(`${element(source)}.click(); true`);
    const channel = `[...document.querySelectorAll('[data-test-id="channel-item"]')].find(
        item => item.textContent.includes('Synthetic playable clip'))`;
    await waitFor(channel, 'The synthetic source did not load its channel.');
    const settings = 'a[href="/workspace/settings"]';
    await evaluate(`${element(settings)}.click(); true`);
    await waitFor('location.pathname === "/workspace/settings/general"', 'Settings did not open.');
    const dashboard = 'a[href="/workspace/dashboard"]';
    await evaluate(`${element(dashboard)}.click(); true`);
    const recentSource = `[...document.querySelectorAll('[data-test-id="dashboard-recent-sources-rail-card-link"]')].find(
        link => link.textContent.includes('Synthetic Android library'))`;
    await waitFor(recentSource, 'Dashboard did not reopen with the recently selected source.');
    await evaluate(`${recentSource}.click(); true`);
    await waitFor(channel, 'Returning from Settings left the channel sidebar on its loading placeholder.');
    await evaluate(`${channel}.click(); true`);
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

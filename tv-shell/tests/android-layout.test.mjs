import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL(
    '../android/app/src/main/assets/tvshell/tv.js', import.meta.url
), 'utf8');

for (const [layout, widget] of [['activity_settings', 'CheckBox'], ['activity_settings_phone', 'Switch']]) {
    test(`${layout} provides the native playback setting bound on startup`, () => {
        const xml = readFileSync(new URL(
            `../android/app/src/main/res/layout/${layout}.xml`, import.meta.url
        ), 'utf8');
        assert.match(xml, new RegExp(`<${widget}\\b[^>]*android:id="@\\+id/native_playback"`));
    });
}

for (const layout of ['touch', 'tv', 'hosted-touch', 'hosted-tv']) {
  for (const android of [true, false]) {
    test(`${layout} layout starts with appropriate navigation and ${android ? 'Android' : 'browser'} bridge`, () => {
        const events = new Set();
        const classes = new Set();
        const intervals = [];
        const messages = [];
        const element = { classList: { add: name => classes.add(name) } };
        const location = { href: 'http://127.0.0.1:43330/' };
        const document = {
            currentScript: {
                getAttribute: name => name === 'data-layout' && layout === 'touch' ? 'touch' : null,
            },
            documentElement: element,
            body: element,
            head: { appendChild() {} },
            createElement: () => ({ setAttribute() {} }),
            addEventListener: name => events.add(name),
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        const window = {
            __tvShellTouchLayout: layout === 'hosted-touch',
            ...(layout === 'touch' || layout === 'hosted-touch' ? {
                __tvShellLibraryConnection: {
                    origin: layout === 'hosted-touch' ? 'https://library.example' : '',
                    savedOrigin: 'https://library.example',
                    approvalOrigin: '',
                    offline: layout === 'touch',
                    paired: true,
                    canScanQr: layout === 'touch',
                },
            } : {}),
            ...(layout === 'hosted-tv' ? { HostedPairing: {} } : {}),
            ...(android ? { TvShell: { postMessage: message => messages.push(JSON.parse(message)) } } : {}),
            addEventListener() {},
        };

        runInNewContext(script, {
            document, window, location,
            navigator: {},
            history: { pushState() {} },
            XMLHttpRequest: class {},
            MutationObserver: class { observe() {} },
            setInterval: callback => intervals.push(callback),
            clearInterval() {},
            console: { log() {} },
        });

        assert.equal(classes.has('tv-shell'), layout === 'tv' || layout === 'hosted-tv');
        for (const name of ['focusin', 'keydown', 'keyup']) {
            assert.equal(events.has(name), layout === 'tv' || layout === 'hosted-tv', name);
        }
        assert.ok(events.has('iptvnator:playback-issue'));
        assert.equal(typeof window.__tvShell.back, 'function');
        const handheld = android && (layout === 'touch' || layout === 'hosted-touch');
        assert.equal(window.__tvShell.handheld, handheld);
        assert.equal(window.__tvShell.openDeviceSettings(), handheld);
        assert.deepEqual(messages, handheld ? [['openSettings']] : []);
        messages.length = 0;
        for (const section of ['server', 'playback', 'device']) {
            assert.equal(window.__tvShell.openSettingsSection(section), handheld);
        }
        assert.equal(window.__tvShell.openSettingsSection('unknown'), false);
        assert.equal(window.__tvShell.openSettingsSection(), false);
        assert.deepEqual(messages, handheld ? [
            ['openSettings', 'server'],
            ['openSettings', 'playback'],
            ['openSettings', 'device'],
        ] : []);
        messages.length = 0;
        if (handheld) {
            const connection = window.__tvShell.libraryConnection();
            assert.deepEqual({ ...connection }, window.__tvShellLibraryConnection);
            connection.origin = 'https://other.example';
            assert.equal(window.__tvShell.libraryConnection().origin, window.__tvShellLibraryConnection.origin);
            assert.equal(window.__tvShell.scanLibraryQr(), layout === 'touch');
            assert.equal(window.__tvShell.disconnectLibrary(), true);
            assert.equal(window.__tvShell.removeLibraryPairing(), true);
            assert.equal(window.__tvShell.pairLibrary('https://library.example', ''), true);
            assert.equal(window.__tvShell.connectLibrary('https://library.example'), true);
            assert.equal(window.__tvShell.pairLibrary('  ', ''), false);
            assert.equal(window.__tvShell.pairLibrary('https://library.example'), false);
            assert.equal(window.__tvShell.connectLibrary(''), false);
            assert.deepEqual(messages, [
                ...(layout === 'touch' ? [['scanLibraryQr']] : []),
                ['disconnectLibrary'],
                ['removeLibraryPairing'],
                ['pairLibrary', 'https://library.example', ''],
                ['connectLibrary', 'https://library.example'],
            ]);
        } else {
            assert.equal(window.__tvShell.libraryConnection, undefined);
            if (android && layout === 'hosted-tv') {
                assert.equal(window.__tvShell.disconnectLibrary(), true);
                assert.deepEqual(messages, [['disconnectLibrary']]);
            }
        }
        messages.length = 0;
        intervals.at(-1)();
        assert.deepEqual(messages, android ? [['onReady', location.href]] : []);
    });
  }
}

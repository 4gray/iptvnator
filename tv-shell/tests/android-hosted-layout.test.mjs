import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../android/app/src/main/assets/tvshell/hosted-layout.js', import.meta.url), 'utf8');

for (const viewport of ['width=device-width, initial-scale=1', 'width=1280, initial-scale=0.75, minimum-scale=0.75, maximum-scale=0.75']) {
    test(`hosted bootstrap applies ${viewport}`, () => {
        let observer, ready, meta;
        const document = {
            querySelector: () => meta,
            head: { appendChild: child => { meta = child; } },
            createElement: () => ({
                attrs: {},
                setAttribute(key, value) { this.attrs[key] = value; },
                getAttribute(key) { return this.attrs[key]; },
            }),
            addEventListener: (name, callback) => { if (name === 'DOMContentLoaded') ready = callback; },
        };
        const window = { __tvShellViewport: viewport };
        runInNewContext(script, {
            document, window,
            MutationObserver: class {
                constructor(callback) { observer = this; this.callback = callback; }
                observe() {}
                disconnect() { this.disconnected = true; }
            },
        });
        meta = document.createElement('meta');
        meta.setAttribute('content', 'width=980');
        observer.callback();
        assert.equal(meta.getAttribute('content'), viewport);
        meta.setAttribute('content', 'width=device-width');
        ready();
        assert.equal(meta.getAttribute('content'), viewport);
        assert.equal(observer.disconnected, true);
    });
}

/**
 * Guards `patches/mpegts.js@<version>.patch`.
 *
 * mpegts.js 1.8.2's `FetchStreamLoader.abort()` skips
 * `AbortController.abort()` while the loader is buffering on Chrome, which
 * includes Electron. It only sets `_requestAbort`, and the reader is cancelled
 * when the next `read()` resolves. A live MPEG-TS stream that stalls (the
 * server stops sending without closing) never resolves that read, so
 * destroying the player leaves its socket open until the page unloads. On a
 * provider that allows one connection per account, the leaked socket holds the
 * slot and the next channel is cut, until the app restarts.
 *
 * The patch aborts unconditionally. `_pump()`'s catch already treats an
 * aborted signal as completion, so the abort raises no loader error.
 *
 * Two checks: the patch targets the installed version, and the shipped bundle
 * (`dist/mpegts.js`, the package's `main`) aborts without the buffering/Chrome
 * guard. A dependency bump that drops the patch must not silently bring the
 * leak back.
 *
 * Retire this test together with the patch once mpegts.js aborts a buffering
 * fetch on Chrome itself.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('mpegts.js/package.json');
const packageDir = path.dirname(packagePath);
const { main, version } = JSON.parse(readFileSync(packagePath, 'utf8'));

describe('mpegts.js loader abort patch', () => {
    it('targets the version the patch was written for', () => {
        const rootPackage = JSON.parse(
            readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
        );
        const patched = Object.keys(
            rootPackage.pnpm?.patchedDependencies ?? {}
        );

        assert.ok(
            patched.includes(`mpegts.js@${version}`),
            `installed mpegts.js ${version} has no entry in pnpm.patchedDependencies (${patched.join(', ')}) — bump or retire the patch`
        );
    });

    it('aborts a buffering fetch in the shipped bundle', () => {
        const bundle = readFileSync(path.join(packageDir, main), 'utf8');

        assert.match(
            bundle,
            /prototype\.abort=function\(\)\{if\(this\._requestAbort=!0,this\._abortController\)try\{this\._abortController\.abort\(\)\}catch\(e\)\{\}\}/
        );
        assert.doesNotMatch(
            bundle,
            /LoaderStatus\.kBuffering\|\|![a-z]\.default\.chrome\)&&this\._abortController/
        );
    });
});

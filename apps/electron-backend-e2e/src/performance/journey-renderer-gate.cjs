'use strict';

/**
 * Main-process gate for the performance journeys, loaded into Electron with
 * `-r` from the test side (the same mechanism Playwright uses for its own
 * loader). It is not part of the application build.
 *
 * Problem: Playwright resolves `electron.launch()` while the app is already
 * creating its window, and an init script registered afterwards races the
 * renderer's first document. Electron reports no page to Playwright until a
 * navigation commits, so the gate makes the first `loadFile`/`loadURL`
 * navigate to `about:blank` first. That gives Playwright a page object the
 * test can attach `addInitScript` to; the real load proceeds only after the
 * test calls `globalThis.__iptvnatorJourneyGate.release()`. A safety timeout
 * releases the gate on its own and records that it did, so a broken test
 * cannot hang the app; the journey treats a timed-out gate as invalid.
 */
const GATE_KEY = '__iptvnatorJourneyGate';
const DEFAULT_TIMEOUT_MS = 15000;

function installJourneyRendererGate(BrowserWindow, target, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const now = options.now ?? (() => Date.now());
    const state = {
        blankLoadedEpochMs: null,
        errors: [],
        gatedEpochMs: null,
        gatedMethod: null,
        passThroughLoads: 0,
        releasedEpochMs: null,
        timedOut: false,
    };
    let releaseGate = null;
    const gate = new Promise((resolve) => {
        releaseGate = resolve;
    });
    const timer = setTimeout(() => {
        if (state.releasedEpochMs === null) {
            state.timedOut = true;
            state.releasedEpochMs = now();
            releaseGate();
        }
    }, timeoutMs);
    const api = {
        release() {
            if (state.releasedEpochMs === null) {
                state.releasedEpochMs = now();
                clearTimeout(timer);
                releaseGate();
            }
            return state;
        },
        state,
    };
    Object.defineProperty(target, GATE_KEY, {
        configurable: false,
        enumerable: false,
        value: api,
        writable: false,
    });
    for (const method of ['loadFile', 'loadURL']) {
        const original = BrowserWindow.prototype[method];
        if (typeof original !== 'function') continue;
        BrowserWindow.prototype[method] = async function gatedLoad(...args) {
            if (state.gatedEpochMs !== null) {
                state.passThroughLoads += 1;
                return original.apply(this, args);
            }
            state.gatedEpochMs = now();
            state.gatedMethod = method;
            try {
                await this.webContents.loadURL('about:blank');
                state.blankLoadedEpochMs = now();
            } catch (error) {
                state.errors.push(
                    error instanceof Error ? error.message : String(error)
                );
            }
            await gate;
            return original.apply(this, args);
        };
    }
    return api;
}

module.exports = { GATE_KEY, installJourneyRendererGate };

if (
    process.versions &&
    process.versions.electron &&
    !process.env['IPTVNATOR_JOURNEY_GATE_MANUAL']
) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow } = require('electron');
    installJourneyRendererGate(BrowserWindow, globalThis);
}

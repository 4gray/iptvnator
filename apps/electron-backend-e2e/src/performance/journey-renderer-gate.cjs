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
 *
 * The detour must not change what the app measures. Electron emits
 * `ready-to-show` for the first paint of a hidden window, and `about:blank`
 * paints too: the app would show the window and freeze its
 * `ready-to-show` counters before its own document exists. The gate
 * therefore drops `ready-to-show` while the window is on `about:blank`;
 * Electron emits it again for the real document's first paint, because the
 * window is still hidden, which is the moment production sees.
 *
 * With `ipcMain` passed in, the gate also keeps the listeners registered
 * with `ipcMain.handle` for `TAPPED_IPC_CHANNELS`, so the test can call a
 * main-process handler that the preload does not expose (the renderer
 * bridge stays unchanged). The registration itself is passed through.
 */
const GATE_KEY = '__iptvnatorJourneyGate';
const DEFAULT_TIMEOUT_MS = 15000;
const BLANK_URL = 'about:blank';
const TAPPED_IPC_CHANNELS = ['performance:read-counters'];

function isShowingBlank(window) {
    try {
        return window.webContents.getURL() === BLANK_URL;
    } catch {
        return false;
    }
}

function holdReadyToShowWhileBlank(window, state) {
    const originalEmit = window.emit;
    if (typeof originalEmit !== 'function') return;
    window.emit = function gatedEmit(eventName, ...args) {
        if (eventName === 'ready-to-show' && isShowingBlank(window)) {
            state.readyToShowHeldOnBlank += 1;
            return false;
        }
        return originalEmit.call(this, eventName, ...args);
    };
}

function tapIpcHandlers(ipcMain, channels) {
    const handlers = new Map();
    const originalHandle = ipcMain.handle;
    ipcMain.handle = function tappedHandle(channel, listener) {
        const result = originalHandle.call(this, channel, listener);
        if (channels.includes(channel)) handlers.set(channel, listener);
        return result;
    };
    return async function invokeHandler(channel, ...args) {
        const listener = handlers.get(channel);
        if (!listener) {
            throw new Error(`journey-ipc-handler-not-registered: ${channel}`);
        }
        return listener({ frameId: -1, sender: null }, ...args);
    };
}

function installJourneyRendererGate(BrowserWindow, target, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const now = options.now ?? (() => Date.now());
    const state = {
        blankLoadedEpochMs: null,
        errors: [],
        gatedEpochMs: null,
        gatedMethod: null,
        passThroughLoads: 0,
        readyToShowHeldOnBlank: 0,
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
    const invokeHandler = options.ipcMain
        ? tapIpcHandlers(options.ipcMain, TAPPED_IPC_CHANNELS)
        : async (channel) => {
              throw new Error(`journey-ipc-handler-tap-missing: ${channel}`);
          };
    const api = {
        invokeHandler,
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
            holdReadyToShowWhileBlank(this, state);
            try {
                await this.webContents.loadURL(BLANK_URL);
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

module.exports = { GATE_KEY, installJourneyRendererGate, TAPPED_IPC_CHANNELS };

if (
    process.versions &&
    process.versions.electron &&
    !process.env['IPTVNATOR_JOURNEY_GATE_MANUAL']
) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow, ipcMain } = require('electron');
    installJourneyRendererGate(BrowserWindow, globalThis, { ipcMain });
}

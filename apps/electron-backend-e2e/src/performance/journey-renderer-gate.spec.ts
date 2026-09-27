import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

interface GateState {
    blankLoadedEpochMs: number | null;
    errors: string[];
    gatedEpochMs: number | null;
    gatedMethod: string | null;
    passThroughLoads: number;
    readyToShowHeldOnBlank: number;
    releasedEpochMs: number | null;
    timedOut: boolean;
}

interface GateApi {
    invokeHandler(channel: string, ...args: unknown[]): Promise<unknown>;
    release(): GateState;
    state: GateState;
}

interface FakeIpcMain {
    handle(channel: string, listener: (...args: unknown[]) => unknown): void;
}

interface GateModule {
    GATE_KEY: string;
    installJourneyRendererGate(
        browserWindow: { prototype: Record<string, unknown> },
        target: Record<string, unknown>,
        options?: {
            ipcMain?: FakeIpcMain;
            now?: () => number;
            timeoutMs?: number;
        }
    ): GateApi;
    TAPPED_IPC_CHANNELS: string[];
}

// The e2e project compiles to CommonJS, so the hook is loaded with require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gateModule = require('./journey-renderer-gate.cjs') as GateModule;

function createFakeBrowserWindow(log: string[]) {
    class FakeBrowserWindow {
        webContents = {
            loadURL: async (url: string) => {
                log.push(`webContents.loadURL:${url}`);
            },
        };
        async loadFile(file: string): Promise<string> {
            log.push(`loadFile:${file}`);
            return `loaded:${file}`;
        }
        async loadURL(url: string): Promise<string> {
            log.push(`loadURL:${url}`);
            return `loaded:${url}`;
        }
    }
    return FakeBrowserWindow;
}

function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 5));
}

test('the module does not touch Electron when loaded outside it', () => {
    assert.equal(typeof gateModule.installJourneyRendererGate, 'function');
    assert.equal(gateModule.GATE_KEY, '__iptvnatorJourneyGate');
    assert.equal(
        (globalThis as Record<string, unknown>)[gateModule.GATE_KEY],
        undefined
    );
});

test('holds the first load behind about:blank until released, then passes later loads through', async () => {
    const log: string[] = [];
    const FakeBrowserWindow = createFakeBrowserWindow(log);
    const target: Record<string, unknown> = {};
    let clock = 100;
    const api = gateModule.installJourneyRendererGate(
        FakeBrowserWindow as unknown as { prototype: Record<string, unknown> },
        target,
        { now: () => clock++, timeoutMs: 60_000 }
    );
    assert.equal(target[gateModule.GATE_KEY], api);
    const window = new FakeBrowserWindow();
    const load = window.loadFile('index.html');
    await settle();
    assert.deepEqual(log, ['webContents.loadURL:about:blank']);
    assert.equal(api.state.gatedMethod, 'loadFile');
    assert.equal(api.state.gatedEpochMs, 100);
    assert.equal(api.state.blankLoadedEpochMs, 101);
    assert.equal(api.state.releasedEpochMs, null);

    api.release();
    assert.equal(await load, 'loaded:index.html');
    assert.deepEqual(log, [
        'webContents.loadURL:about:blank',
        'loadFile:index.html',
    ]);
    assert.equal(api.state.releasedEpochMs, 102);
    assert.equal(api.state.timedOut, false);

    assert.equal(
        await window.loadURL('http://localhost/'),
        'loaded:http://localhost/'
    );
    assert.equal(api.state.passThroughLoads, 1);
    assert.equal(api.release().releasedEpochMs, 102);
});

test('releases itself after the timeout and records it', async () => {
    const log: string[] = [];
    const FakeBrowserWindow = createFakeBrowserWindow(log);
    const api = gateModule.installJourneyRendererGate(
        FakeBrowserWindow as unknown as { prototype: Record<string, unknown> },
        {},
        { timeoutMs: 10 }
    );
    const window = new FakeBrowserWindow();
    assert.equal(
        await window.loadURL('http://localhost/'),
        'loaded:http://localhost/'
    );
    assert.equal(api.state.timedOut, true);
    assert.equal(typeof api.state.releasedEpochMs, 'number');
});

test('records a failed about:blank navigation and still loads after release', async () => {
    class BrokenBrowserWindow {
        webContents = {
            loadURL: async () => {
                throw new Error('blank-failed');
            },
        };
        async loadFile(file: string): Promise<string> {
            return `loaded:${file}`;
        }
    }
    const api = gateModule.installJourneyRendererGate(
        BrokenBrowserWindow as unknown as {
            prototype: Record<string, unknown>;
        },
        {},
        { timeoutMs: 60_000 }
    );
    const load = new BrokenBrowserWindow().loadFile('index.html');
    await settle();
    assert.deepEqual(api.state.errors, ['blank-failed']);
    api.release();
    assert.equal(await load, 'loaded:index.html');
});

function createEmittingBrowserWindow(log: string[]) {
    class EmittingBrowserWindow extends EventEmitter {
        url = '';
        webContents = {
            getURL: () => this.url,
            loadURL: async (url: string) => {
                this.url = url;
                log.push(`webContents.loadURL:${url}`);
            },
        };
        async loadFile(file: string): Promise<void> {
            this.url = `file:///${file}`;
            log.push(`loadFile:${file}`);
        }
    }
    return EmittingBrowserWindow;
}

test('holds ready-to-show while the window shows about:blank, then lets the real one through', async () => {
    const log: string[] = [];
    const EmittingBrowserWindow = createEmittingBrowserWindow(log);
    const api = gateModule.installJourneyRendererGate(
        EmittingBrowserWindow as unknown as {
            prototype: Record<string, unknown>;
        },
        {},
        { timeoutMs: 60_000 }
    );
    const window = new EmittingBrowserWindow();
    window.once('ready-to-show', () => log.push('app:ready-to-show'));
    const load = window.loadFile('index.html');
    await settle();
    // Electron's first paint of about:blank.
    assert.equal(window.emit('ready-to-show'), false);
    window.emit('did-finish-load');
    assert.equal(api.state.readyToShowHeldOnBlank, 1);

    api.release();
    await load;
    window.emit('ready-to-show');

    assert.deepEqual(log, [
        'webContents.loadURL:about:blank',
        'loadFile:index.html',
        'app:ready-to-show',
    ]);
    assert.equal(api.state.readyToShowHeldOnBlank, 1);
});

test('taps ipcMain.handle for the counters channel and passes registrations through', async () => {
    const registered: string[] = [];
    const ipcMain: FakeIpcMain = {
        handle(channel) {
            registered.push(channel);
        },
    };
    const api = gateModule.installJourneyRendererGate(
        createFakeBrowserWindow([]) as unknown as {
            prototype: Record<string, unknown>;
        },
        {},
        { ipcMain, timeoutMs: 60_000 }
    );
    assert.deepEqual(gateModule.TAPPED_IPC_CHANNELS, [
        'performance:read-counters',
    ]);
    await assert.rejects(
        api.invokeHandler('performance:read-counters'),
        /journey-ipc-handler-not-registered: performance:read-counters/
    );

    ipcMain.handle('performance:read-counters', (event, ...args) => ({
        args,
        sender: (event as { sender: unknown }).sender,
    }));
    ipcMain.handle('db:other', () => 'other');

    assert.deepEqual(registered, ['performance:read-counters', 'db:other']);
    assert.deepEqual(await api.invokeHandler('performance:read-counters', 1), {
        args: [1],
        sender: null,
    });
    await assert.rejects(api.invokeHandler('db:other'), /not-registered/);
    api.release();
});

test('refuses handler calls when no ipcMain was tapped', async () => {
    const api = gateModule.installJourneyRendererGate(
        createFakeBrowserWindow([]) as unknown as {
            prototype: Record<string, unknown>;
        },
        {},
        { timeoutMs: 60_000 }
    );
    await assert.rejects(
        api.invokeHandler('performance:read-counters'),
        /journey-ipc-handler-tap-missing/
    );
    api.release();
});

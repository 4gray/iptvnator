import assert from 'node:assert/strict';
import test from 'node:test';

interface GateState {
    blankLoadedEpochMs: number | null;
    errors: string[];
    gatedEpochMs: number | null;
    gatedMethod: string | null;
    passThroughLoads: number;
    releasedEpochMs: number | null;
    timedOut: boolean;
}

interface GateApi {
    release(): GateState;
    state: GateState;
}

interface GateModule {
    GATE_KEY: string;
    installJourneyRendererGate(
        browserWindow: { prototype: Record<string, unknown> },
        target: Record<string, unknown>,
        options?: { now?: () => number; timeoutMs?: number }
    ): GateApi;
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

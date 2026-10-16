import { spawn, type ChildProcess } from 'node:child_process';
import { buildElectronLaunchArgs } from './electron-test-fixtures';
import { terminateElectronProcess } from './electron-process-termination';

/**
 * Launches the built app WITHOUT Playwright and drives it over plain Chrome
 * DevTools Protocol sockets.
 *
 * Playwright sends `Emulation.setFocusEmulationEnabled` to every page it
 * attaches to, and Chromium implements focus emulation by raising the page's
 * capturer count, which pins the page visible. A test about
 * `document.visibilityState` (or anything throttled while hidden) therefore
 * cannot run through `launchElectronApp`. Raw `Runtime.evaluate` calls do
 * not emulate anything, so this launch behaves like a user's.
 */
export interface UnautomatedElectronApp {
    /** Evaluates an async function body in the main process with `electron`. */
    evaluateInMain<T>(body: string): Promise<T>;
    /** Evaluates an expression in the main window's page. */
    evaluateInPage<T>(expression: string): Promise<T>;
    close(): Promise<void>;
}

interface CdpSocket {
    send(method: string, params?: object): Promise<Record<string, unknown>>;
    close(): void;
}

const EXIT_WAIT_MS = 5_000;
/**
 * `electron` for main-process evaluation. `process.mainModule` exists only
 * when the app entry is CommonJS; a require created from the core `module`
 * builtin resolves Electron's built-in module either way.
 */
const MAIN_PROCESS_ELECTRON = `process.getBuiltinModule('node:module').createRequire(process.execPath)('electron')`;
const DEVTOOLS_PATTERN = /DevTools listening on (ws:\/\/[^\s]+)/;
const INSPECTOR_PATTERN = /Debugger listening on (ws:\/\/[^\s]+)/;
const STARTUP_TIMEOUT_MS = 30_000;

async function openCdpSocket(url: string): Promise<CdpSocket> {
    const socket = new WebSocket(url);
    const pending = new Map<
        number,
        (message: Record<string, unknown>) => void
    >();
    let nextId = 0;
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener(
            'error',
            () => reject(new Error(`CDP ${url}`)),
            {
                once: true,
            }
        );
    });
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as Record<
            string,
            unknown
        >;
        // Only replies to our own numbered requests settle a promise; events
        // and unknown ids are ignored.
        const id = message['id'];
        if (typeof id !== 'number') return;
        const settle = pending.get(id);
        if (typeof settle !== 'function') return;
        pending.delete(id);
        settle(message);
    });
    return {
        send: (method, params = {}) =>
            new Promise((resolve) => {
                const id = ++nextId;
                pending.set(id, resolve);
                socket.send(JSON.stringify({ id, method, params }));
            }),
        close: () => socket.close(),
    };
}

function waitForEndpoints(
    child: ChildProcess
): Promise<{ devtools: string; inspector: string }> {
    return new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
            () => reject(new Error(`Electron did not start:\n${output}`)),
            STARTUP_TIMEOUT_MS
        );
        child.stderr?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            const devtools = output.match(DEVTOOLS_PATTERN)?.[1];
            const inspector = output.match(INSPECTOR_PATTERN)?.[1];
            if (devtools && inspector) {
                clearTimeout(timer);
                resolve({ devtools, inspector });
            }
        });
        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`Electron exited (${code}):\n${output}`));
        });
    });
}

async function findMainPage(devtools: string): Promise<string> {
    const origin = new URL(devtools).host;
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const targets = (await (
            await fetch(`http://${origin}/json/list`)
        ).json()) as {
            type: string;
            url: string;
            webSocketDebuggerUrl: string;
        }[];
        const page = targets.find(
            (target) =>
                target.type === 'page' && target.url.includes('index.html')
        );
        if (page) return page.webSocketDebuggerUrl;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('The main window never loaded its page');
}

async function evaluate<T>(socket: CdpSocket, expression: string): Promise<T> {
    const response = await socket.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    const protocolError = response['error'] as { message?: string } | undefined;
    if (protocolError) {
        throw new Error(
            `CDP Runtime.evaluate: ${protocolError.message ?? 'failed'}`
        );
    }
    const result = response['result'] as {
        result?: { value?: T };
        exceptionDetails?: { text?: string };
    };
    if (result?.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'evaluation failed');
    }
    return result?.result?.value as T;
}

function waitForExit(
    child: ChildProcess,
    exited: Promise<void>,
    timeoutMs: number
): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(true);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * Bounded like `closeElectronApplicationAndConfirmExit`: a stuck Electron
 * must neither stall the worker nor keep holding the test profile.
 */
async function stopElectron(
    child: ChildProcess,
    exited: Promise<void>
): Promise<void> {
    let lastKillError: unknown;
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        // Already gone (exited on its own, or during startup): nothing to
        // kill. On Windows taskkill throws for a PID that no longer exists.
        if (await waitForExit(child, exited, 0)) return;
        try {
            terminateElectronProcess(child, signal);
        } catch (error) {
            // The process may have exited between the check and the kill.
            lastKillError = error;
        }
        if (await waitForExit(child, exited, EXIT_WAIT_MS)) return;
    }
    const killFailure =
        lastKillError === undefined
            ? ''
            : ` (last kill: ${String(lastKillError)})`;
    throw new Error(
        `Electron (pid ${child.pid}) did not exit after SIGTERM and SIGKILL${killFailure}`
    );
}

export async function launchUnautomatedElectronApp(
    dataDir: string
): Promise<UnautomatedElectronApp> {
    // In a Node context the `electron` package resolves to its binary path.
    const electronBinaryPath = require('electron') as unknown as string;
    const child = spawn(
        electronBinaryPath,
        buildElectronLaunchArgs(['--remote-debugging-port=0', '--inspect=0']),
        {
            env: {
                ...process.env,
                ELECTRON_IS_DEV: '0',
                IPTVNATOR_E2E_DATA_DIR: dataDir,
                NODE_ENV: 'test',
            },
            stdio: ['ignore', 'ignore', 'pipe'],
        }
    );
    const exited = new Promise<void>((resolve) =>
        child.once('exit', () => resolve())
    );
    try {
        const { devtools, inspector } = await waitForEndpoints(child);
        const main = await openCdpSocket(inspector);
        const page = await openCdpSocket(await findMainPage(devtools));
        return {
            evaluateInMain: (body) =>
                evaluate(
                    main,
                    `(async (electron) => { ${body} })(${MAIN_PROCESS_ELECTRON})`
                ),
            evaluateInPage: (expression) => evaluate(page, expression),
            close: async () => {
                page.close();
                main.close();
                await stopElectron(child, exited);
            },
        };
    } catch (error) {
        // Cleanup must never replace the startup failure that explains the test.
        await stopElectron(child, exited).catch((cleanupError: unknown) =>
            console.warn('Unautomated Electron cleanup failed:', cleanupError)
        );
        throw error;
    }
}

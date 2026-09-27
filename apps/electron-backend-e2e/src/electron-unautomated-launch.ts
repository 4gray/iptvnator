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
        const message = JSON.parse(String(event.data));
        pending.get(message.id)?.(message);
        pending.delete(message.id);
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
    const result = response['result'] as {
        result?: { value?: T };
        exceptionDetails?: { text?: string };
    };
    if (result?.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'evaluation failed');
    }
    return result?.result?.value as T;
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
                    `(async (electron) => { ${body} })(process.mainModule.require('electron'))`
                ),
            evaluateInPage: (expression) => evaluate(page, expression),
            close: async () => {
                page.close();
                main.close();
                terminateElectronProcess(child);
                await exited;
            },
        };
    } catch (error) {
        terminateElectronProcess(child, 'SIGKILL');
        await exited;
        throw error;
    }
}

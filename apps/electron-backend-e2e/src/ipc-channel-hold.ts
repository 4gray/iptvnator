import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LaunchedElectronApp } from './electron-test-fixtures';
import {
    electronMainPath,
    expect,
    launchElectronApp,
} from './electron-test-fixtures';

interface ChannelHold {
    /** Invocations parked behind the hold, waiting for `release`. */
    waiting: number;
    gate: Promise<void>;
    release: () => void;
}

type HoldGlobal = typeof globalThis & {
    __ipcChannelHolds?: Record<string, ChannelHold | undefined>;
    __ipcChannelHoldInstalled?: string[];
};

// Serialized into the test bootstrap; all runtime dependencies are arguments.
function installChannelHolds(
    { ipcMain }: Pick<typeof import('electron'), 'ipcMain'>,
    channels: readonly string[]
): void {
    const register = ipcMain.handle;
    const scope = globalThis as HoldGlobal;
    scope.__ipcChannelHolds = {};
    scope.__ipcChannelHoldInstalled = [];
    // Wraps the listener at registration through the public API; no
    // Electron-private handler registry is read or mutated.
    ipcMain.handle = function (channel, listener) {
        if (!channels.includes(channel)) {
            return register.call(this, channel, listener);
        }
        scope.__ipcChannelHoldInstalled?.push(channel);
        return register.call(this, channel, async (...args) => {
            const hold = scope.__ipcChannelHolds?.[channel];
            if (hold) {
                hold.waiting += 1;
                await hold.gate;
            }
            return listener(...args);
        });
    };
}

/**
 * Launches the app with `channels` wrapped so a test can park their
 * invocations (`holdIpcChannel`) and keep a loading state on screen for as
 * long as it measures it.
 */
export function launchElectronWithChannelHolds(
    dataDir: string,
    channels: readonly string[]
): Promise<LaunchedElectronApp> {
    const entryPoint = join(dataDir, 'ipc-channel-holds.cjs');
    writeFileSync(
        entryPoint,
        [
            `(${installChannelHolds.toString()})(require('electron'), ${JSON.stringify(channels)});`,
            `require(${JSON.stringify(electronMainPath)});`,
        ].join('\n')
    );
    return launchElectronApp(dataDir, { entryPoint });
}

/** Parks every later invocation of `channel` until the returned release. */
export async function holdIpcChannel(
    app: LaunchedElectronApp,
    channel: string
) {
    await app.electronApp.evaluate((_electron, name) => {
        const scope = globalThis as HoldGlobal;
        if (!scope.__ipcChannelHoldInstalled?.includes(name)) {
            throw new Error(`IPC channel ${name} has no hold installed`);
        }
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const holds = (scope.__ipcChannelHolds ??= {});
        holds[name] = { waiting: 0, gate, release };
    }, channel);

    return {
        waitUntilHeld: () =>
            expect
                .poll(() =>
                    app.electronApp.evaluate(
                        (_electron, name) =>
                            (globalThis as HoldGlobal).__ipcChannelHolds?.[name]
                                ?.waiting ?? 0,
                        channel
                    )
                )
                .toBeGreaterThan(0),
        release: () =>
            app.electronApp.evaluate((_electron, name) => {
                const holds = (globalThis as HoldGlobal).__ipcChannelHolds;
                const hold = holds?.[name];
                if (!hold) throw new Error(`IPC channel ${name} is not held`);
                delete holds[name];
                hold.release();
            }, channel),
    };
}

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LaunchedElectronApp } from './electron-test-fixtures';
import {
    electronMainPath,
    expect,
    launchElectronApp,
} from './electron-test-fixtures';

interface WriteGateState {
    held: boolean;
    release: () => void;
    finished: Promise<void>;
    gate: Promise<void>;
    finish: () => void;
}

type GateGlobal = typeof globalThis & {
    __playlistWriteGate?: WriteGateState;
    __playlistWriteGateInstalled?: boolean;
};

// Serialized into the test bootstrap; all runtime dependencies are arguments.
function installWriteGate({
    ipcMain,
}: Pick<typeof import('electron'), 'ipcMain'>): void {
    const register = ipcMain.handle;
    ipcMain.handle = function (channel, listener) {
        if (channel !== 'DB_UPSERT_APP_PLAYLIST') {
            return register.call(this, channel, listener);
        }
        // Capture registration through the public API, then restore it. No
        // Electron-private handler registry is read or mutated.
        ipcMain.handle = register;
        (globalThis as GateGlobal).__playlistWriteGateInstalled = true;
        return register.call(this, channel, async (...args) => {
            const state = (globalThis as GateGlobal).__playlistWriteGate;
            if (!state || state.held) return listener(...args);
            state.held = true;
            await state.gate;
            try {
                return await listener(...args);
            } finally {
                state.finish();
            }
        });
    };
}

export function launchElectronWithWriteGate(
    dataDir: string
): Promise<LaunchedElectronApp> {
    const entryPoint = join(dataDir, 'playlist-write-gate.cjs');
    writeFileSync(
        entryPoint,
        [
            `(${installWriteGate.toString()})(require('electron'));`,
            `require(${JSON.stringify(electronMainPath)});`,
        ].join('\n')
    );
    return launchElectronApp(dataDir, { entryPoint });
}

/** Hold one real SQLite write so navigation can race refresh deterministically. */
export async function holdNextPlaylistWrite(app: LaunchedElectronApp) {
    await app.electronApp.evaluate(() => {
        if (!(globalThis as GateGlobal).__playlistWriteGateInstalled) {
            throw new Error('Playlist write gate bootstrap was not installed');
        }
        let release!: () => void;
        let finish!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const state: WriteGateState = {
            held: false,
            release,
            finished,
            gate,
            finish,
        };
        (globalThis as GateGlobal).__playlistWriteGate = state;
    });

    return {
        waitUntilHeld: () =>
            expect
                .poll(() =>
                    app.electronApp.evaluate(
                        () =>
                            (globalThis as GateGlobal).__playlistWriteGate?.held
                    )
                )
                .toBe(true),
        release: () =>
            app.electronApp.evaluate(async () => {
                const state = (globalThis as GateGlobal).__playlistWriteGate;
                if (!state) throw new Error('Playlist write gate is missing');
                state.release();
                await state.finished;
            }),
    };
}

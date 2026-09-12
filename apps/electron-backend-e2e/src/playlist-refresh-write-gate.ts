import type { LaunchedElectronApp } from './electron-test-fixtures';
import { expect } from './electron-test-fixtures';

interface WriteGateState {
    held: boolean;
    release: () => void;
    finished: Promise<void>;
}

type GateGlobal = typeof globalThis & { __playlistWriteGate?: WriteGateState };

/** Hold one real SQLite write so navigation can race refresh deterministically. */
export async function holdNextPlaylistWrite(app: LaunchedElectronApp) {
    await app.electronApp.evaluate(({ ipcMain }) => {
        const channel = 'DB_UPSERT_APP_PLAYLIST';
        // Test-only interception preserves the real handler and database worker.
        const handlers = (
            ipcMain as unknown as {
                _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
            }
        )._invokeHandlers;
        const original = handlers.get(channel);
        if (!original) throw new Error('Playlist write handler is missing');
        let release!: () => void;
        let finish!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const state: WriteGateState = { held: false, release, finished };
        (globalThis as GateGlobal).__playlistWriteGate = state;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (...args) => {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, original);
            state.held = true;
            await gate;
            try {
                return await original(...args);
            } finally {
                finish();
            }
        });
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

import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

interface PollingFixture {
    pending: boolean;
    release: () => void;
}

for (const stage of ['snapshot', 'state'] as const) {
    test(`@electron @playback VLC ignores the replaced session's ${stage} reply`, async ({
        dataDir,
    }) => {
        const desktop = await launchElectronApp(dataDir);
        try {
            const playerPath = join(dataDir, 'synthetic-vlc');
            // Keep IPC, polling, RC TCP and renderer delivery real. Replace
            // only the native process boundary; CI does not install VLC.
            await desktop.electronApp.evaluate(
                (_, { playerPath, stage }) => {
                    const childProcess =
                        process.getBuiltinModule('child_process');
                    const { EventEmitter } = process.getBuiltinModule('events');
                    const { createServer } = process.getBuiltinModule('net');
                    const spawn = childProcess.spawn;
                    const fixture: PollingFixture = {
                        pending: false,
                        release: () => undefined,
                    };
                    Reflect.set(globalThis, '__vlcPollingFixture', fixture);
                    childProcess.spawn = ((
                        command: string,
                        args: readonly string[] = [],
                        options?: import('node:child_process').SpawnOptions
                    ) => {
                        if (command !== playerPath)
                            return Reflect.apply(spawn, childProcess, [
                                command,
                                args,
                                options,
                            ]);
                        const portArg = args.find((arg) =>
                            arg.startsWith('--rc-host=')
                        );
                        if (!portArg) throw new Error('Missing RC port');
                        const port = Number(portArg.split(':').pop());
                        let replaced = false;
                        const server = createServer((socket) => {
                            socket.on('data', (chunk) => {
                                const command = chunk.toString().trim();
                                if (command === 'clear') replaced = true;
                                const hold =
                                    !replaced &&
                                    ((stage === 'snapshot' &&
                                        command === 'get_time') ||
                                        (stage === 'state' &&
                                            command === 'status'));
                                if (hold) {
                                    fixture.pending = true;
                                    socket.once('close', () => {
                                        fixture.pending = false;
                                    });
                                    fixture.release = () => {
                                        if (
                                            !fixture.pending ||
                                            socket.destroyed ||
                                            socket.readableEnded ||
                                            socket.writableEnded
                                        ) {
                                            throw new Error(
                                                'Held RC reply expired before replacement'
                                            );
                                        }
                                        socket.write(
                                            stage === 'snapshot'
                                                ? '> 77'
                                                : '( state stopped ) >'
                                        );
                                        fixture.pending = false;
                                    };
                                } else if (command === 'get_time') {
                                    socket.write(
                                        !replaced && stage === 'state'
                                            ? '> '
                                            : '> 22'
                                    );
                                } else if (command === 'get_length') {
                                    socket.write('> 120');
                                } else socket.write('> ');
                            });
                        });
                        const proc = Object.assign(new EventEmitter(), {
                            exitCode: null as number | null,
                            signalCode: null,
                            killed: false,
                            stdout: null,
                            stderr: null,
                            unref: () => undefined,
                            kill: () => {
                                proc.killed = true;
                                proc.exitCode = 0;
                                server.close();
                                proc.emit('exit', 0);
                                return true;
                            },
                        });
                        server.listen(port, '127.0.0.1', () =>
                            proc.emit('spawn')
                        );
                        return proc;
                    }) as typeof spawn;
                },
                { playerPath, stage }
            );
            const page = desktop.mainWindow;
            const first = await page.evaluate(async (playerPath) => {
                Reflect.set(window, '__vlcPositionEvents', []);
                window.electron.onPlaybackPositionUpdate((event) => {
                    Reflect.get(window, '__vlcPositionEvents').push(event);
                });
                await window.electron.setVlcPlayerPath(playerPath);
                await window.electron.updateSettings({
                    vlcReuseInstance: true,
                });
                return window.electron.openInVlc(
                    'https://media.example.test/first.mp4',
                    'First synthetic movie',
                    '',
                    undefined,
                    undefined,
                    undefined,
                    {
                        playlistId: 'synthetic-playlist',
                        contentXtreamId: 1,
                        contentType: 'vod',
                    }
                );
            }, playerPath);
            await expect
                .poll(() =>
                    desktop.electronApp.evaluate(
                        () =>
                            (
                                Reflect.get(
                                    globalThis,
                                    '__vlcPollingFixture'
                                ) as PollingFixture
                            ).pending
                    )
                )
                .toBe(true);
            const second = await page.evaluate(() =>
                window.electron.openInVlc(
                    'https://media.example.test/second.mp4',
                    'Second synthetic movie',
                    '',
                    undefined,
                    undefined,
                    undefined,
                    {
                        playlistId: 'synthetic-playlist',
                        contentXtreamId: 2,
                        contentType: 'vod',
                    }
                )
            );
            expect(second.id).not.toBe(first.id);
            await desktop.electronApp.evaluate(() =>
                (
                    Reflect.get(
                        globalThis,
                        '__vlcPollingFixture'
                    ) as PollingFixture
                ).release()
            );
            // The new session must survive the old reply and emit its own poll.
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        Reflect.get(window, '__vlcPositionEvents')
                    )
                )
                .toEqual([
                    expect.objectContaining({
                        sessionId: second.id,
                        playlistId: 'synthetic-playlist',
                        contentXtreamId: 2,
                        positionSeconds: 22,
                        durationSeconds: 120,
                    }),
                ]);
            const closed = await page.evaluate(
                (id) => window.electron.closeExternalPlayerSession(id),
                second.id
            );
            expect(closed?.status).toBe('closed');
        } finally {
            await closeElectronApp(desktop);
        }
    });
}

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('net', () => ({
    createConnection: jest.fn(),
    createServer: jest.fn(),
}));
jest.mock('../app', () => ({
    __esModule: true,
    default: { mainWindow: null },
}));
jest.mock('../services/store.service', () => ({
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    VLC_REUSE_INSTANCE: 'VLC_REUSE_INSTANCE',
    store: { get: jest.fn() },
}));
jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: jest.fn(),
}));

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createConnection, createServer } from 'net';
import {
    store,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import { getVlcPlaybackSnapshot } from './vlc-rc';
import { openVlcPlayer, shutdownVlcSession } from './vlc-session.service';
import { requestWithValidatedRedirects } from '../util/validated-axios';

const spawnMock = spawn as unknown as jest.Mock;
const serverMock = createServer as unknown as jest.Mock;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const open = (name: string) =>
    openVlcPlayer({ title: name, url: `https://example.test/${name}.ts` });

function child() {
    return Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null,
        killed: false,
        kill: jest.fn(),
        unref: jest.fn(),
    });
}

function exit(proc: ReturnType<typeof child>, code = 0) {
    proc.exitCode = code;
    proc.emit('exit', code);
}

function mockRc(
    respond: (
        port: number | string,
        command: string,
        reply: (data?: string) => void
    ) => void
) {
    (createConnection as unknown as jest.Mock).mockImplementation(
        (address: string | { port: number }) => {
            const port = typeof address === 'string' ? address : address.port;
            const socket = Object.assign(new EventEmitter(), {
                destroyed: false,
                write: (command: string) => {
                    setImmediate(() =>
                        respond(port, command, (data = '> ') =>
                            socket.emit('data', Buffer.from(data))
                        )
                    );
                },
                destroy: () => (socket.destroyed = true),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        }
    );
}

describe('VLC exact playback ownership', () => {
    const ports: (() => void)[] = [];

    beforeEach(() => {
        jest.resetAllMocks();
        (requestWithValidatedRedirects as jest.Mock).mockRejectedValue(
            new Error('Synthetic input is not a playlist')
        );
        ports.length = 0;
        (store.get as jest.Mock).mockImplementation((key, fallback) =>
            key === VLC_PLAYER_PATH
                ? '/usr/bin/vlc'
                : key === VLC_REUSE_INSTANCE || fallback
        );
        let nextPort = 43210;
        serverMock.mockImplementation(() => {
            const port = nextPort++;
            return {
                unref: jest.fn(),
                on: jest.fn(),
                listen: (_port: number, _host: string, ready: () => void) =>
                    ready(),
                address: () => ({ port }),
                close: (release: () => void) => ports.push(release),
            };
        });
    });

    afterEach(() => {
        shutdownVlcSession();
        jest.useRealTimers();
    });

    it('starts the newer VLC tune after closing the older launch’s fallback', async () => {
        if (process.platform === 'win32') return;
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        const first = child();
        const fallback = child();
        const second = child();
        spawnMock
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(fallback)
            .mockReturnValueOnce(second);
        mockRc(() => undefined);
        try {
            const initial = openVlcPlayer({
                title: 'Synthetic A',
                url: 'https://example.test/a.ts',
                launchId: 'synthetic-a',
            });
            first.emit('spawn');
            const original = await initial;
            const next = openVlcPlayer({
                title: 'Synthetic B',
                url: 'https://example.test/b.ts',
                launchId: 'synthetic-b',
            });
            exit(first, 1);
            fallback.emit('spawn');
            await jest.advanceTimersByTimeAsync(2_100);
            await tick();
            expect(fallback.kill).toHaveBeenCalledTimes(1);
            expect(spawnMock).toHaveBeenCalledTimes(2);
            exit(fallback);
            await tick();
            expect(spawnMock).toHaveBeenCalledTimes(3);
            second.emit('spawn');
            expect(await next).toMatchObject({
                status: 'opened',
                launchId: 'synthetic-b',
            });
            expect(externalPlayerSessions.getSession(original.id)?.status).toBe(
                'closed'
            );
        } finally {
            for (const proc of [first, fallback, second])
                if (proc.exitCode === null) exit(proc);
        }
    });

    it('stops the exact timed-out detached VLC before retrying the same input', async () => {
        if (process.platform === 'win32') return;
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        (store.get as jest.Mock).mockImplementation((key, fallback) =>
            key === VLC_PLAYER_PATH ? '/usr/bin/vlc' : fallback
        );
        const first = child();
        const second = child();
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        mockRc(() => undefined);
        const request = {
            title: 'Synthetic Channel',
            url: 'https://example.test/a.ts',
        };
        try {
            const initial = openVlcPlayer({
                ...request,
                launchId: 'synthetic-a',
            });
            first.emit('spawn');
            const original = await initial;
            await jest.advanceTimersByTimeAsync(30_000);
            expect(
                externalPlayerSessions.getSession(original.id)
                    ?.mediaReadinessTimedOut
            ).toBe(true);
            const next = openVlcPlayer({
                ...request,
                launchId: 'synthetic-retry',
            });
            await tick();
            expect(first.kill).toHaveBeenCalledTimes(1);
            expect(spawnMock).toHaveBeenCalledTimes(1);
            exit(first);
            await tick();
            expect(spawnMock).toHaveBeenCalledTimes(2);
            second.emit('spawn');
            expect(await next).toMatchObject({
                status: 'opened',
                launchId: 'synthetic-retry',
            });
        } finally {
            for (const proc of [first, second])
                if (proc.exitCode === null) exit(proc);
        }
    });

    it('keeps the reused child closable after another fresh launch takes the reuse slot', async () => {
        const first = child();
        const second = child();
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        let addSent!: (reply: () => void) => void;
        const pendingAdd = new Promise<() => void>(
            (resolve) => (addSent = resolve)
        );
        mockRc((port, command, reply) => {
            if (command.startsWith('add ')) {
                addSent(reply);
            } else {
                reply();
                if (command === 'quit\n' && port === 43210) exit(first);
            }
        });

        const firstOpening = open('first');
        const secondOpening = open('second');
        await tick();
        ports[0]();
        await tick();
        first.emit('spawn');
        const firstSession = await firstOpening;
        const replacement = open('replacement');
        const finishAdd = await pendingAdd;

        ports[1]();
        await tick();
        second.emit('spawn');
        const secondSession = await secondOpening;
        finishAdd();
        const replacementSession = await replacement;

        expect(externalPlayerSessions.getSession(firstSession.id)?.status).toBe(
            'closed'
        );
        expect(replacementSession).toMatchObject({
            status: 'opened',
            canClose: true,
        });
        await expect(
            externalPlayerSessions.closeSession(replacementSession.id, true)
        ).resolves.toMatchObject({ status: 'closed' });
        expect(first.exitCode).toBe(0);
        expect(second.kill).not.toHaveBeenCalled();
        expect(
            externalPlayerSessions.getSession(secondSession.id)?.status
        ).toBe('opened');
        exit(second);
    });

    it('clears the old RC state on fallback and ignores late status replies', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        const initial = child();
        const retry = child();
        spawnMock.mockReturnValueOnce(initial).mockReturnValueOnce(retry);
        let lateReply: (() => void) | undefined;
        let queryCount = 0;
        mockRc((_port, command, reply) => {
            if (command !== 'status\n') return;
            if (++queryCount === 1) reply('( state playing )\n> ');
            else lateReply = () => reply('( state stopped )\n> ');
        });
        const opening = open('initial');
        await tick();
        ports[0]();
        await tick();
        initial.emit('spawn');
        const session = await opening;
        await jest.advanceTimersByTimeAsync(2_000);
        await tick();
        await tick();
        expect(
            externalPlayerSessions.getSession(session.id)?.playbackIdle
        ).toBe(false);
        await jest.advanceTimersByTimeAsync(2_000);
        await tick();
        await tick();
        expect(lateReply).toBeDefined();

        exit(initial, 1);
        retry.emit('spawn');
        expect(spawnMock.mock.calls[1][1]).not.toContain('--extraintf=rc');
        expect(
            externalPlayerSessions.getSession(session.id)?.playbackIdle
        ).toBeUndefined();
        lateReply?.();
        await tick();
        expect(externalPlayerSessions.getSession(session.id)).toMatchObject({
            status: 'opened',
            canClose: true,
            playbackIdle: undefined,
        });
        exit(retry);
    });

    it.each([
        ['( state playing )', '( state stopped )'],
        ['( play state: 3 )', '( stop state: 5 )'],
    ])(
        'keeps reading the first child after a second takes the reuse slot (%s)',
        async (playing, stopped) => {
            jest.useFakeTimers({ doNotFake: ['setImmediate'] });
            const first = child();
            const second = child();
            spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
            let firstState = playing;
            mockRc((port, command, reply) => {
                if (command === 'status\n')
                    reply(`${port === 43210 ? firstState : playing}\n`);
            });
            const firstOpening = open('first');
            const secondOpening = open('second');
            await tick();
            ports[0]();
            await tick();
            first.emit('spawn');
            const session = await firstOpening;
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(
                externalPlayerSessions.getSession(session.id)?.playbackIdle
            ).toBe(false);

            ports[1]();
            await tick();
            second.emit('spawn');
            await secondOpening;
            firstState = '( unknown state: -1 )';
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                { playbackIdle: false, playbackUnverified: true }
            );
            firstState = stopped;
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(
                externalPlayerSessions.getSession(session.id)?.playbackIdle
            ).toBe(true);
            expect(
                externalPlayerSessions.getSession(session.id)
                    ?.playbackUnverified
            ).toBeUndefined();
            exit(first);
            exit(second);
        }
    );

    it.each(['direct', 'M3U'] as const)(
        'confirms only the requested VLC input even when instance reuse is disabled (%s)',
        async (kind) => {
            jest.useFakeTimers({ doNotFake: ['setImmediate'] });
            (store.get as jest.Mock).mockImplementation((key, fallback) =>
                key === VLC_PLAYER_PATH
                    ? '/usr/bin/vlc'
                    : key === VLC_REUSE_INSTANCE
                      ? false
                      : fallback
            );
            const proc = child();
            spawnMock.mockReturnValueOnce(proc);
            const url =
                kind === 'M3U'
                    ? 'https://example.test/synthetic/playlist.m3u8'
                    : 'https://example.test/synthetic%20channel.ts';
            const currentInput =
                kind === 'M3U'
                    ? 'https://example.test/synthetic/synthetic-child.ts'
                    : decodeURIComponent(url);
            if (kind === 'M3U')
                (requestWithValidatedRedirects as jest.Mock).mockResolvedValue({
                    data: '#EXTM3U x-tvg-url="https://example.test/synthetic.xml"\n#EXTINF:-1,Synthetic Child\nsynthetic-child.ts\n',
                });
            let input = 'https://example.test/synthetic-old.ts';
            let playbackTime = 0;
            let switchDuringClock = false;
            mockRc((port, command, reply) => {
                expect(typeof port).toBe('string');
                if (command === 'status\n')
                    reply(
                        '( new input: https://example.test/synthetic-stale.ts )\r\n' +
                            '( stop state: 0 )\r\n' +
                            `( new input: ${input} )\r\n( play state: 3 )\r\n` +
                            'status: returned 0 (no error)\r\n( stop state: 5 )\r\n'
                    );
                if (command === 'get_time\n') {
                    if (switchDuringClock)
                        input = 'https://example.test/synthetic-other.ts';
                    reply(`${playbackTime}\r\n`);
                }
            });
            const opening = openVlcPlayer({
                title: 'Synthetic Channel',
                url,
                launchId: 'synthetic-guide-launch',
            });
            await tick();
            proc.emit('spawn');
            const session = await opening;
            expect(session).toMatchObject({
                status: 'opened',
                mediaLoaded: false,
            });
            const args = spawnMock.mock.lastCall?.[1] as string[];
            expect(ports).toHaveLength(0);
            expect(args.some((arg) => arg.startsWith('--rc-host=127.'))).toBe(
                false
            );
            if (process.platform === 'win32') {
                expect(session.mediaObservationUnavailable).toBe(true);
                exit(proc);
                return;
            }
            expect(args).toEqual(
                expect.arrayContaining([
                    '--extraintf=oldrc',
                    '--rc-fake-tty',
                    '--rc-host=',
                ])
            );
            expect(args.some((arg) => arg.startsWith('--rc-unix='))).toBe(true);
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                {
                    mediaLoaded: false,
                    playbackUnverified: undefined,
                }
            );
            playbackTime = 2;
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                {
                    mediaLoaded: false,
                    playbackUnverified: true,
                }
            );
            input = currentInput;
            playbackTime = 0;
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                {
                    mediaLoaded: false,
                    playbackIdle: false,
                    playbackUnverified: undefined,
                }
            );
            await jest.advanceTimersByTimeAsync(24_000);
            await tick();
            await tick();
            expect(
                externalPlayerSessions.getSession(session.id)
                    ?.mediaReadinessTimedOut
            ).toBe(true);
            playbackTime = 2;
            for (
                let poll = 0;
                poll < 3 &&
                !externalPlayerSessions.getSession(session.id)?.mediaLoaded;
                poll++
            ) {
                await jest.advanceTimersByTimeAsync(2_000);
                // Confirmation reads status again after the clock and any M3U lookup.
                for (let turn = 0; turn < 6; turn++) await tick();
            }
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                {
                    mediaLoaded: true,
                    playbackIdle: false,
                    mediaReadinessTimedOut: undefined,
                }
            );
            input = 'https://example.test/synthetic-other.ts';
            await jest.advanceTimersByTimeAsync(2_000);
            await tick();
            await tick();
            expect(externalPlayerSessions.getSession(session.id)).toMatchObject(
                {
                    mediaLoaded: false,
                    playbackIdle: false,
                    playbackUnverified: true,
                }
            );
            input = currentInput;
            switchDuringClock = true;
            await jest.advanceTimersByTimeAsync(2_000);
            for (let turn = 0; turn < 6; turn++) await tick();
            expect(
                externalPlayerSessions.getSession(session.id)?.mediaLoaded
            ).toBe(false);
            expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(1);
            expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
                url,
                expect.objectContaining({
                    maxContentLength: 64 * 1024,
                    timeout: 2_000,
                }),
                { allowPrivateNetworks: true },
                0
            );
            exit(proc);
        }
    );

    it.each([false, true])(
        'waits for the exact VLC child without private control before a replacement (new input: %s)',
        async (newInput) => {
            const platform = Object.getOwnPropertyDescriptor(
                process,
                'platform'
            );
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const first = child();
            const second = child();
            spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
            const request = {
                title: 'Synthetic Channel',
                url: 'https://example.test/synthetic.ts',
            };
            try {
                const initial = openVlcPlayer({
                    ...request,
                    launchId: 'synthetic-first',
                });
                first.emit('spawn');
                const prior = await initial;
                expect(prior).toMatchObject({
                    mediaObservationUnavailable: true,
                    canClose: true,
                });
                const retry = openVlcPlayer({
                    ...request,
                    url: newInput
                        ? 'https://example.test/synthetic-other.ts'
                        : request.url,
                    launchId: 'synthetic-retry',
                });
                await tick();
                expect(first.kill).toHaveBeenCalledTimes(1);
                expect(spawnMock).toHaveBeenCalledTimes(1);
                exit(first);
                await tick();
                expect(spawnMock).toHaveBeenCalledTimes(2);
                expect(spawnMock.mock.lastCall?.[2]).toMatchObject({
                    detached: false,
                    stdio: 'ignore',
                });
                expect(ports).toHaveLength(0);
                second.emit('spawn');
                expect((await retry).id).not.toBe(prior.id);
                expect(
                    externalPlayerSessions.getSession(prior.id)?.status
                ).toBe('closed');
            } finally {
                exit(first);
                exit(second);
                if (platform)
                    Object.defineProperty(process, 'platform', platform);
            }
        }
    );

    it('terminates an open TCP-controlled window before taking its slot even if its media session closed', async () => {
        const first = child();
        const second = child();
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const opening = open('synthetic-first');
        await tick();
        ports[0]();
        await tick();
        first.emit('spawn');
        const prior = await opening;
        externalPlayerSessions.markClosed(prior.id);
        try {
            const replacement = openVlcPlayer({
                title: 'Synthetic Channel',
                url: 'https://example.test/synthetic-next.ts',
                launchId: 'synthetic-guide-launch',
            });
            expect(first.kill).toHaveBeenCalledTimes(1);
            expect(spawnMock).toHaveBeenCalledTimes(1);
            exit(first, 1);
            await tick();
            expect(spawnMock).toHaveBeenCalledTimes(2);
            expect(spawnMock.mock.lastCall?.[2]).toMatchObject({
                detached: false,
                stdio: 'ignore',
            });
            second.emit('spawn');
            expect((await replacement).status).toBe('opened');
        } finally {
            exit(first);
            exit(second);
        }
    });

    it('discards a stopped Unix RC snapshot without treating a real zero position as stopped', async () => {
        let duration = 0;
        mockRc((_address, command, reply) => {
            reply(`${command === 'get_length\n' ? duration : 0}\r\n`);
        });
        const socket = '/tmp/synthetic-vlc-control';
        await expect(getVlcPlaybackSnapshot(socket)).resolves.toBeNull();
        duration = 300;
        await expect(getVlcPlaybackSnapshot(socket)).resolves.toEqual({
            positionSeconds: 0,
            durationSeconds: 300,
        });
    });

    it('rejects the add command during unrelated teardown and keeps the VLC child closable', async () => {
        const proc = child();
        const blocker = child();
        spawnMock.mockReturnValueOnce(proc);
        const opening = open('first');
        await tick();
        ports[0]();
        await tick();
        proc.emit('spawn');
        await opening;

        const writes: string[] = [];
        mockRc((_port, command, reply) => {
            writes.push(command);
            if (command === 'clear\n')
                externalPlayerProcessTeardownGate.beginTeardown(
                    blocker as unknown as ChildProcess
                );
            reply();
            if (command === 'quit\n') exit(proc);
        });
        try {
            const replacement = open('replacement');
            const id = externalPlayerSessions.getActiveSessionId() as string;
            await expect(replacement).rejects.toThrow(
                'previous external player is still shutting down'
            );
            expect(writes).toEqual(['clear\n']);
            expect(externalPlayerSessions.getSession(id)).toMatchObject({
                status: 'error',
                canClose: true,
            });
            await expect(
                externalPlayerSessions.closeSession(id, true)
            ).resolves.toMatchObject({ status: 'closed' });
            expect(writes).toEqual(['clear\n', 'quit\n']);
        } finally {
            exit(blocker);
        }
    });

    it('allows exact close to retry an unconfirmed teardown after clear was sent', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        const proc = child();
        spawnMock.mockReturnValueOnce(proc);
        const opening = open('first');
        await tick();
        ports[0]();
        await tick();
        proc.emit('spawn');
        await opening;

        let addSent!: () => void;
        const pendingAdd = new Promise<void>((resolve) => (addSent = resolve));
        mockRc((_port, command, reply) => {
            if (command === 'clear\n') reply();
            if (command.startsWith('add ')) addSent();
        });
        const replacement = open('replacement');
        const id = externalPlayerSessions.getActiveSessionId() as string;
        const failedLaunch =
            expect(replacement).rejects.toThrow('did not exit');
        await pendingAdd;
        await jest.advanceTimersByTimeAsync(2_000);
        expect(proc.kill).toHaveBeenCalledTimes(1);

        const exactClose = externalPlayerSessions.closeSession(id, true);
        const failedClose = expect(exactClose).rejects.toThrow('did not exit');
        await tick();
        expect(externalPlayerSessions.getSession(id)?.status).toBe('launching');
        await jest.advanceTimersByTimeAsync(5_000);
        await Promise.all([failedLaunch, failedClose]);
        expect(externalPlayerSessions.getSession(id)).toMatchObject({
            status: 'error',
            canClose: true,
        });

        mockRc((_port, command, reply) => {
            if (command === 'quit\n') {
                reply();
                exit(proc);
            }
        });
        await expect(
            externalPlayerSessions.closeSession(id, true)
        ).resolves.toMatchObject({
            status: 'closed',
        });
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });
});

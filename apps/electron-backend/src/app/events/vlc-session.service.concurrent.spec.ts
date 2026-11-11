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

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { createConnection, createServer } from 'net';
import {
    store,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { openVlcPlayer, shutdownVlcSession } from './vlc-session.service';

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
        port: number,
        command: string,
        reply: (data?: string) => void
    ) => void
) {
    (createConnection as unknown as jest.Mock).mockImplementation(
        ({ port }) => {
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

    it('keeps reading the first child after a second takes the reuse slot', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
        const first = child();
        const second = child();
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        let firstState = 'playing';
        mockRc((port, command, reply) => {
            if (command === 'status\n')
                reply(
                    `( state ${port === 43210 ? firstState : 'playing'} )\n> `
                );
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
        firstState = 'stopped';
        await jest.advanceTimersByTimeAsync(2_000);
        await tick();
        await tick();
        expect(
            externalPlayerSessions.getSession(session.id)?.playbackIdle
        ).toBe(true);
        exit(first);
        exit(second);
    });
});

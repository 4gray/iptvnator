/**
 * Shared fixtures for the reused-MPV specs: a mock child, a reusable
 * instance to hand launches over to, and IPC sockets that answer, stay
 * silent, or let `quit` stop the child.
 */
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createConnection } from 'net';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import {
    createMpvSocketMock,
    MpvSocketMock,
    MpvSocketMockOptions,
} from './mpv-ipc-socket.test-helpers';
import { openMpvPlayer } from './mpv-session.service';

export const spawnMock = spawn as unknown as jest.Mock;
export const createConnectionMock = createConnection as unknown as jest.Mock;

export function createMockChildProcess(): ChildProcess {
    const proc = Object.assign(new EventEmitter(), {
        exitCode: null,
        killed: false,
        kill: jest.fn(),
        signalCode: null,
        stderr: null,
        stdout: null,
        unref: jest.fn(),
    }) as unknown as ChildProcess;
    (proc.kill as jest.Mock).mockImplementation(() => {
        setImmediate(() => {
            Object.defineProperty(proc, 'exitCode', { value: 0 });
            proc.emit('exit', 0);
        });
        return true;
    });
    return proc;
}

export function mockMpvSockets(options: MpvSocketMockOptions = {}): void {
    createConnectionMock.mockImplementation(() => createMpvSocketMock(options));
}

export function nextTick(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Spawns the reusable instance a later launch is handed over to. */
export async function launchReusableInstance(): Promise<ChildProcess> {
    return (await launchReusableSession()).proc;
}

export async function launchReusableSession(): Promise<{
    proc: ChildProcess;
    session: ExternalPlayerSession;
}> {
    const proc = createMockChildProcess();
    spawnMock.mockReturnValueOnce(proc);
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            ({
                [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                [MPV_REUSE_INSTANCE]: true,
            })[key] ?? fallback
    );
    const session = await openMpvPlayer({
        title: 'First stream',
        url: 'https://example.com/one.m3u8',
    });
    return { proc, session };
}

/** A socket whose written command mpv never answers; the test replies. */
export function mockUnansweredSockets(): MpvSocketMock[] {
    const sockets: MpvSocketMock[] = [];
    createConnectionMock.mockImplementation(() => {
        const socket = createMpvSocketMock({ reply: () => null });
        sockets.push(socket);
        return socket;
    });
    return sockets;
}

/**
 * Like mockUnansweredSockets, but a `quit` succeeds and the child then exits,
 * as a real mpv does.
 */
export function mockSocketsQuittingInto(proc: ChildProcess): MpvSocketMock[] {
    const sockets: MpvSocketMock[] = [];
    createConnectionMock.mockImplementation(() => {
        const socket = createMpvSocketMock({
            reply: (command) => {
                if (command[0] !== 'quit') return null;
                setImmediate(() => {
                    Object.defineProperty(proc, 'exitCode', { value: 0 });
                    proc.emit('exit', 0);
                });
                return 'success';
            },
        });
        sockets.push(socket);
        return socket;
    });
    return sockets;
}

export function commandsOf(sockets: MpvSocketMock[]): string[] {
    return sockets.map(
        (socket) =>
            (
                JSON.parse(String(socket.write.mock.calls[0][0])) as {
                    command: string[];
                }
            ).command[0]
    );
}

export async function writtenRequestId(socket: MpvSocketMock): Promise<number> {
    while (!socket?.write.mock.calls.length) {
        await nextTick();
    }
    return (
        JSON.parse(socket.write.mock.calls[0][0] as string) as {
            request_id: number;
        }
    ).request_id;
}

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
    ExternalPlayerProcessTeardownGate,
    terminateExternalPlayerProcess,
    waitForExternalPlayerProcessExit,
} from './external-player-process';

function createMockChildProcess(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        exitCode: null,
        killed: false,
        kill: jest.fn(() => true),
        signalCode: null,
        stderr: null,
        stdout: null,
        unref: jest.fn(),
    }) as unknown as ChildProcess;
}

describe('external player process teardown', () => {
    it('accepts close as confirmed termination after a spawn error', async () => {
        const child = createMockChildProcess();
        child.on('error', () => undefined);
        let settled = false;
        const exit = waitForExternalPlayerProcessExit(child).then(() => {
            settled = true;
        });

        child.emit(
            'error',
            Object.assign(new Error('spawn failed'), { code: 'ENOENT' })
        );
        await Promise.resolve();
        expect(settled).toBe(false);

        child.emit('close', -2, null);

        await expect(exit).resolves.toBeUndefined();
    });

    it('does not treat a process error as confirmed exit', async () => {
        const child = createMockChildProcess();
        child.on('error', () => undefined);
        let settled = false;
        const exit = waitForExternalPlayerProcessExit(child).then(() => {
            settled = true;
        });

        child.emit('error', new Error('kill failed'));
        await Promise.resolve();

        expect(settled).toBe(false);

        Object.defineProperty(child, 'exitCode', { value: 0 });
        child.emit('exit', 0);

        await expect(exit).resolves.toBeUndefined();
    });

    it('escalates teardown and resolves only after confirmed exit', async () => {
        jest.useFakeTimers();
        try {
            const child = createMockChildProcess();
            const teardown = terminateExternalPlayerProcess(child);

            expect(child.kill).toHaveBeenNthCalledWith(1);

            await jest.advanceTimersByTimeAsync(3_000);

            expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

            child.emit('close', null, 'SIGKILL');

            await expect(teardown).resolves.toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it('allows a protocol quit grace period before forced termination', async () => {
        jest.useFakeTimers();
        try {
            const child = createMockChildProcess();
            const teardown = terminateExternalPlayerProcess(child, {
                sendTerminationSignal: false,
            });

            expect(child.kill).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(3_000);

            expect(child.kill).toHaveBeenCalledWith('SIGKILL');

            child.emit('exit', null, 'SIGKILL');

            await expect(teardown).resolves.toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects after a bounded forced-teardown wait', async () => {
        jest.useFakeTimers();
        try {
            const child = createMockChildProcess();
            const teardown = terminateExternalPlayerProcess(child);
            const result = expect(teardown).rejects.toThrow(
                'External player process did not exit'
            );

            await jest.advanceTimersByTimeAsync(5_000);

            await result;
            expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
        } finally {
            jest.useRealTimers();
        }
    });

    it('blocks replacement launches until an unconfirmed child actually exits', async () => {
        jest.useFakeTimers();
        try {
            const child = createMockChildProcess();
            const gate = new ExternalPlayerProcessTeardownGate();
            const teardown = gate.terminate(child);
            const rejection = expect(teardown).rejects.toThrow(
                'External player process did not exit'
            );

            expect(() => gate.assertLaunchAllowed()).toThrow(
                'previous external player is still shutting down'
            );

            await jest.advanceTimersByTimeAsync(5_000);
            await rejection;

            expect(() => gate.assertLaunchAllowed()).toThrow(
                'previous external player is still shutting down'
            );

            Object.defineProperty(child, 'exitCode', { value: 0 });
            child.emit('exit', 0);

            expect(() => gate.assertLaunchAllowed()).not.toThrow();
        } finally {
            jest.useRealTimers();
        }
    });
});

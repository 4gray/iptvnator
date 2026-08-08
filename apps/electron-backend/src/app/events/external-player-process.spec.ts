import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { waitForExternalPlayerProcessExit } from './external-player-process';

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
});

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { stopVlcProcess } from './vlc-process-control';

function stubbornProcess(): ChildProcess {
    const child = new EventEmitter() as ChildProcess;
    const stdin = Object.assign(new EventEmitter(), {
        writable: true,
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
    });
    Object.assign(child, {
        exitCode: null,
        stdin,
        kill: jest.fn().mockImplementation((signal: string) => {
            return signal === 'SIGKILL';
        }),
    });
    return child;
}

describe('VLC process control', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('starts forced termination only once when stop paths race', async () => {
        const child = stubbornProcess();
        const stopping = stopVlcProcess(child, 1);
        const rejected = expect(stopping).rejects.toThrow(
            'did not exit after SIGKILL'
        );

        child.stdin?.emit('error', new Error('EPIPE'));
        await jest.advanceTimersByTimeAsync(1_001);
        await rejected;

        const kill = child.kill as jest.Mock;
        const forcedKills = kill.mock.calls.filter(
            ([signal]) => signal === 'SIGKILL'
        );
        expect(forcedKills).toHaveLength(1);
    });
});

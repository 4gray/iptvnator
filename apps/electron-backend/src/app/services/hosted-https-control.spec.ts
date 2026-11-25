import { EventEmitter } from 'node:events';
import type { UtilityProcess } from 'electron';
import { configureHostedHttps } from './hosted-https-control';

describe('HTTPS worker acknowledgement', () => {
    afterEach(() => jest.useRealTimers());

    function worker() {
        return Object.assign(new EventEmitter(), { postMessage: jest.fn() });
    }

    it('ignores unrelated and old responses and removes listeners on acknowledgement', async () => {
        const child = worker();
        const result = configureHostedHttps(
            child as unknown as UtilityProcess,
            'https://library.example.test'
        );
        const command = child.postMessage.mock.calls[0][0];
        child.emit('message', { ready: true, instanceId: 'synthetic' });
        child.emit('message', {
            https: true,
            requestId: 'old',
            origin: 'https://stale.example.test',
        });
        expect(child.listenerCount('message')).toBe(1);
        child.emit('message', {
            https: true,
            requestId: command.requestId,
            origin: command.httpsOrigin,
        });
        expect(await result).toMatchObject({ origin: command.httpsOrigin });
        expect(child.listenerCount('message')).toBe(0);
        expect(child.listenerCount('exit')).toBe(0);
    });

    it('bounds a missing acknowledgement and cleans up after worker exit', async () => {
        jest.useFakeTimers();
        const child = worker();
        const timedOut = configureHostedHttps(
            child as unknown as UtilityProcess,
            ''
        );
        const rejected = expect(timedOut).rejects.toThrow(
            'HTTPS listener unavailable'
        );
        await jest.advanceTimersByTimeAsync(10000);
        await rejected;
        expect(child.listenerCount('message')).toBe(0);
        const exited = configureHostedHttps(
            child as unknown as UtilityProcess,
            ''
        );
        child.emit('exit', 1);
        await expect(exited).rejects.toThrow('HTTPS listener unavailable');
        expect(child.listenerCount('message')).toBe(0);
    });
});

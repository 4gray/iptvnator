import { EventEmitter } from 'node:events';
import { createHostedWorkerClient } from './hosted-worker-client';

describe('hosted worker client', () => {
    const worker = Object.assign(new EventEmitter(), {
        postMessage: jest.fn(),
    });
    const send = createHostedWorkerClient(worker as never);
    const request = { method: 'GET', path: '/v1/devices' } as const;

    beforeEach(() => worker.postMessage.mockReset());
    afterEach(() => {
        expect(worker.listenerCount('message')).toBe(0);
        expect(worker.listenerCount('exit')).toBe(0);
        jest.useRealTimers();
    });

    it('matches concurrent responses by request ID and ignores unrelated messages', async () => {
        const first = send(request);
        const secondRequest = { ...request, path: '/v1/instance' };
        const second = send(secondRequest);
        const [firstMessage, secondMessage] = worker.postMessage.mock.calls.map(
            ([message]) => message
        );
        expect(firstMessage.workerRequest).toEqual(request);
        expect(secondMessage.workerRequest).toEqual(secondRequest);
        expect(firstMessage.requestId).not.toBe(secondMessage.requestId);
        worker.emit('message', { ready: true, instanceId: 'synthetic' });
        worker.emit('message', {
            reply: 'unrelated',
            response: { status: 500 },
        });
        worker.emit('message', {
            reply: secondMessage.requestId,
            response: { status: 200, body: { instanceId: 'synthetic' } },
        });
        worker.emit('message', { reply: firstMessage.requestId });
        await expect(second).resolves.toEqual({
            status: 200,
            body: { instanceId: 'synthetic' },
        });
        await expect(first).rejects.toThrow('Hosted worker request failed');
    });

    it('rejects if the worker exits, cannot accept the request, or never replies', async () => {
        const exited = expect(send(request)).rejects.toThrow(
            'Hosted worker request failed'
        );
        worker.emit('exit');
        await exited;
        worker.postMessage.mockImplementationOnce(() => {
            throw new Error('synthetic transport failure');
        });
        await expect(send(request)).rejects.toThrow(
            'Hosted worker request failed'
        );
        jest.useFakeTimers();
        const timeout = expect(send(request)).rejects.toThrow(
            'Hosted worker request failed'
        );
        await jest.advanceTimersByTimeAsync(125_000);
        await timeout;
    });
});

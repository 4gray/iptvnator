import { createCheckQueue } from './vod-multi-source-check-queue';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('createCheckQueue', () => {
    it('never runs more tasks than the limit at once', async () => {
        const queue = createCheckQueue(2);
        const gates = Array.from({ length: 5 }, createDeferred);
        let running = 0;
        let peak = 0;

        const all = gates.map((gate) =>
            queue(async () => {
                running++;
                peak = Math.max(peak, running);
                await gate.promise;
                running--;
            })
        );
        await settle();
        expect(running).toBe(2);

        gates.forEach((gate) => gate.resolve());
        await Promise.all(all);
        expect(peak).toBe(2);
        expect(running).toBe(0);
    });

    it('starts waiting tasks in arrival order as slots free up', async () => {
        const queue = createCheckQueue(1);
        const first = createDeferred();
        const started: string[] = [];

        const a = queue(async () => {
            started.push('a');
            await first.promise;
        });
        const b = queue(async () => {
            started.push('b');
        });
        const c = queue(async () => {
            started.push('c');
        });

        await settle();
        expect(started).toEqual(['a']);

        first.resolve();
        await Promise.all([a, b, c]);
        expect(started).toEqual(['a', 'b', 'c']);
    });

    it('releases the slot when a task rejects', async () => {
        const queue = createCheckQueue(1);

        await expect(
            queue(() => Promise.reject(new Error('boom')))
        ).rejects.toThrow('boom');

        // A leaked slot would leave this waiting forever.
        await expect(queue(async () => 'after')).resolves.toBe('after');
    });
});

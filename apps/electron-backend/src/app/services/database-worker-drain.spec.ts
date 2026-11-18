import { EventEmitter } from 'events';
import { waitForSettled, waitForWorkerExit } from './database-worker-drain';

describe('database worker drain waits', () => {
    it('waits for promises added while it is waiting', async () => {
        const tracked = new Set<Promise<unknown>>();
        let releaseLate!: () => void;
        const first = Promise.resolve().then(() => {
            tracked.delete(first);
            const late = new Promise<void>((resolve) => {
                releaseLate = resolve;
            }).then(() => tracked.delete(late));
            tracked.add(late);
        });
        tracked.add(first);

        const wait = waitForSettled(tracked, 1000);
        await new Promise((resolve) => setImmediate(resolve));
        releaseLate();

        await expect(wait).resolves.toBe(true);
        expect(tracked.size).toBe(0);
    });

    it('resolves false once the budget runs out', async () => {
        const tracked = new Set<Promise<unknown>>([
            new Promise(() => undefined),
        ]);

        await expect(waitForSettled(tracked, 10)).resolves.toBe(false);
    });

    it('reports whether the worker exited within the budget', async () => {
        const exiting = new EventEmitter();
        const exited = waitForWorkerExit(exiting, 1000);
        exiting.emit('exit', 0);
        await expect(exited).resolves.toBe(true);

        const stuck = new EventEmitter();
        await expect(waitForWorkerExit(stuck, 10)).resolves.toBe(false);
        expect(stuck.listenerCount('exit')).toBe(0);
    });
});

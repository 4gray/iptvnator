import { ActivityLocalWriteQueue } from './activity-local-write-queue';
const position = {
    contentType: 'vod' as const,
    contentXtreamId: 42,
    positionSeconds: 10,
};
describe('local activity write ordering', () => {
    it('waits for the current item write before its next point', async () => {
        const queue = new ActivityLocalWriteQueue();
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const order: string[] = [];
        const first = queue.run('synthetic-source', position, async () => {
            order.push('first');
            await held;
        });
        const second = queue.run('synthetic-source', position, async () => {
            order.push('second');
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(['first']);
        release();
        await Promise.all([first, second, queue.wait('synthetic-source')]);
        expect(order).toEqual(['first', 'second']);
    });
    it('does not let a failed write block a later point', async () => {
        const queue = new ActivityLocalWriteQueue();
        const first = queue.run('synthetic-source', position, async () => {
            throw new Error('Synthetic failure');
        });
        let saved = false;
        const second = queue.run('synthetic-source', position, async () => {
            saved = true;
        });
        const results = await Promise.allSettled([first, second]);
        expect(results.map((value) => value.status)).toEqual([
            'rejected',
            'fulfilled',
        ]);
        expect(saved).toBe(true);
        await queue.wait('synthetic-source');
    });
});

import { ActivityMutationBarrier } from './activity-mutation-barrier';
describe('activity mutation drain', () => {
    it('waits for other writes after one mutation rejects', async () => {
        const barrier = new ActivityMutationBarrier();
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = barrier.track(
            Promise.reject(new Error('Synthetic write failure'))
        );
        const second = barrier.track(held);
        const settled = Promise.allSettled([first, second]);
        let drained = false;
        const drain = barrier.drain().then(() => {
            drained = true;
        });
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(drained).toBe(false);
        release();
        await drain;
        expect((await settled).map((entry) => entry.status)).toEqual([
            'rejected',
            'fulfilled',
        ]);
    });
});

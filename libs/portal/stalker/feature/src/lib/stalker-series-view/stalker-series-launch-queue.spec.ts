import { StalkerSeriesLaunchQueue } from './stalker-series-launch-queue';

function deferred(): { promise: Promise<void>; settle: () => void } {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => (settle = resolve));
    return { promise, settle };
}

describe('StalkerSeriesLaunchQueue', () => {
    const A = 'playlist-1:100';
    const B = 'playlist-1:200';

    it('plays the last choice held during a launch once it settles', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const launch = deferred();
        const run = queue.run(
            A,
            () => launch.promise,
            () => true
        );
        const first = jest.fn();
        const second = jest.fn();

        expect(queue.isLaunching(A)).toBe(true);
        queue.hold(A, first);
        queue.hold(A, second);
        expect(second).not.toHaveBeenCalled();

        launch.settle();
        await run;

        expect(queue.isLaunching(A)).toBe(false);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps a choice for one series when a launch of another settles first', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const launchA = deferred();
        const launchB = deferred();
        const runA = queue.run(
            A,
            () => launchA.promise,
            () => false
        );
        const runB = queue.run(
            B,
            () => launchB.promise,
            () => true
        );
        const choiceB = jest.fn();
        queue.hold(B, choiceB);

        // The page shows B now: A settling must not touch B's choice.
        launchA.settle();
        await runA;
        expect(choiceB).not.toHaveBeenCalled();
        expect(queue.isLaunching(B)).toBe(true);

        launchB.settle();
        await runB;
        expect(choiceB).toHaveBeenCalledTimes(1);
    });

    it('drops the choice when the page moved on, even if the launch failed', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const choice = jest.fn();
        const run = queue.run(
            A,
            () => Promise.reject(new Error('launch failed')),
            () => false
        );
        queue.hold(A, choice);

        await expect(run).rejects.toThrow('launch failed');
        expect(choice).not.toHaveBeenCalled();
        expect(queue.isLaunching(A)).toBe(false);
    });
});

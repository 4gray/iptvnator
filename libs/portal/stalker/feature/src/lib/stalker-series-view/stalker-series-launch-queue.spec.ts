import {
    StalkerSeriesLaunchQueue,
    type StalkerSeriesLaunchRelease,
} from './stalker-series-launch-queue';

function deferred<T = void>(): {
    promise: Promise<T>;
    settle: (value: T) => void;
} {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => (settle = resolve));
    return { promise, settle };
}

function release(
    overrides: Partial<StalkerSeriesLaunchRelease> = {}
): StalkerSeriesLaunchRelease {
    return {
        stillShown: () => true,
        replacePlayer: () => Promise.resolve(true),
        ...overrides,
    };
}

describe('StalkerSeriesLaunchQueue', () => {
    const A = 'playlist-1:100';
    const B = 'playlist-1:200';

    it('plays the last choice held during a launch once it settles', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const launch = deferred();
        const run = queue.run(A, () => launch.promise, release());
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

    it('replaces the player the launch opened before the held choice starts', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const replace = deferred<boolean>();
        const replacePlayer = jest.fn().mockReturnValue(replace.promise);
        const run = queue.run(
            A,
            () => Promise.resolve(),
            release({ replacePlayer })
        );
        const choice = jest.fn();
        queue.hold(A, choice);
        await Promise.resolve();
        await Promise.resolve();

        // The choice must not play beside the opened player, and nothing
        // else may start while that player closes.
        expect(replacePlayer).toHaveBeenCalledTimes(1);
        expect(choice).not.toHaveBeenCalled();
        expect(queue.isLaunching(A)).toBe(true);

        replace.settle(true);
        await run;
        expect(choice).toHaveBeenCalledTimes(1);
        expect(queue.isLaunching(A)).toBe(false);
    });

    it('starts the choice held while the player closed, not the earlier one', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const replace = deferred<boolean>();
        const run = queue.run(
            A,
            () => Promise.resolve(),
            release({ replacePlayer: () => replace.promise })
        );
        const earlier = jest.fn();
        const latest = jest.fn();
        queue.hold(A, earlier);
        await Promise.resolve();
        await Promise.resolve();

        // Still launching while the player closes: the viewer's newer pick
        // must not be stranded behind the one that triggered the close.
        expect(queue.isLaunching(A)).toBe(true);
        queue.hold(A, latest);

        replace.settle(true);
        await run;
        expect(earlier).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
        expect(queue.isLaunching(A)).toBe(false);
    });

    it('keeps the player and drops the choice when it cannot be replaced', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const choice = jest.fn();
        const run = queue.run(
            A,
            () => Promise.resolve(),
            release({ replacePlayer: () => Promise.resolve(false) })
        );
        queue.hold(A, choice);

        await run;
        expect(choice).not.toHaveBeenCalled();
        expect(queue.isLaunching(A)).toBe(false);
    });

    it('keeps a choice for one series when a launch of another settles first', async () => {
        const queue = new StalkerSeriesLaunchQueue();
        const launchA = deferred();
        const launchB = deferred();
        const runA = queue.run(
            A,
            () => launchA.promise,
            release({ stillShown: () => false })
        );
        const runB = queue.run(B, () => launchB.promise, release());
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
        const replacePlayer = jest.fn();
        const run = queue.run(
            A,
            () => Promise.reject(new Error('launch failed')),
            release({ stillShown: () => false, replacePlayer })
        );
        queue.hold(A, choice);

        await expect(run).rejects.toThrow('launch failed');
        expect(replacePlayer).not.toHaveBeenCalled();
        expect(choice).not.toHaveBeenCalled();
        expect(queue.isLaunching(A)).toBe(false);
    });
});

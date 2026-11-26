import { EventEmitter } from 'events';
import { registerQuitTeardown } from './quit-teardown';

class FakeApp extends EventEmitter {
    quit = jest.fn(() => this.fireWillQuit());
    prevented = 0;

    /** Mirrors Electron: a quit proceeds unless a listener prevents it. */
    fireWillQuit(): boolean {
        let prevented = false;
        this.emit('will-quit', {
            preventDefault: () => {
                prevented = true;
            },
        });
        if (prevented) this.prevented++;
        return !prevented;
    }
}

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
}

describe('registerQuitTeardown', () => {
    it('holds the quit until the drain settles, then resumes it once', async () => {
        const app = new FakeApp();
        const stopNow = jest.fn();
        const drain = deferred();
        const drainHook = jest.fn(() => drain.promise);
        registerQuitTeardown(app, { stopNow, drain: drainHook });

        expect(app.fireWillQuit()).toBe(false);
        expect(stopNow).toHaveBeenCalledTimes(1);
        // A second quit request while draining neither exits nor re-drains.
        expect(app.fireWillQuit()).toBe(false);
        expect(drainHook).toHaveBeenCalledTimes(1);
        expect(app.quit).not.toHaveBeenCalled();

        drain.resolve();
        await flushPromises();

        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(app.prevented).toBe(2);
        expect(stopNow).toHaveBeenCalledTimes(1);
    });

    it('lets the quit through untouched when there is nothing to drain', () => {
        const app = new FakeApp();
        const stopNow = jest.fn();
        registerQuitTeardown(app, { stopNow, drain: () => null });

        expect(app.fireWillQuit()).toBe(true);
        expect(stopNow).toHaveBeenCalledTimes(1);
        expect(app.quit).not.toHaveBeenCalled();
    });

    it('still quits when the drain fails', async () => {
        const app = new FakeApp();
        const drain = deferred();
        registerQuitTeardown(app, {
            stopNow: jest.fn(),
            drain: () => drain.promise,
        });

        app.fireWillQuit();
        drain.reject(new Error('worker failed'));
        await flushPromises();

        expect(app.quit).toHaveBeenCalledTimes(1);
    });

    it('never waits past its cap for a drain that does not settle', async () => {
        const app = new FakeApp();
        registerQuitTeardown(app, {
            stopNow: jest.fn(),
            drain: () => new Promise<void>(() => undefined),
            timeoutMs: 10,
        });

        app.fireWillQuit();
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(app.quit).toHaveBeenCalledTimes(1);
    });
});

import { EventEmitter } from 'node:events';

import { createDeferredBootstrap } from './deferred-bootstrap';

interface FakeModule {
    readonly name: string;
}

const fakeModule: FakeModule = { name: 'deferred' };

/** Mirrors webpack's node chunk loading: a synchronous require behind a resolved promise. */
const loadResolved = () => Promise.resolve(fakeModule);

function macrotask(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe('deferred main-process bootstrap', () => {
    it('registers handlers before the next macrotask once the window starts loading', async () => {
        const order: string[] = [];
        const webContents = new EventEmitter();
        const bootstrap = createDeferredBootstrap({
            load: loadResolved,
            run: (module) => {
                order.push(`run:${module.name}`);
                return 'registered';
            },
        });
        bootstrap.armOn(webContents);

        // An IPC message that the renderer sends right after it starts
        // loading arrives as a macrotask; it must queue behind registration.
        setImmediate(() => order.push('renderer-ipc'));
        webContents.emit('did-start-loading');
        await macrotask();

        expect(order).toEqual(['run:deferred', 'renderer-ipc']);
        expect(bootstrap.module).toBe(fakeModule);
    });

    it('runs the deferred work exactly once across both triggers', async () => {
        const run = jest.fn(() => 'once');
        const load = jest.fn(loadResolved);
        const webContents = new EventEmitter();
        const bootstrap = createDeferredBootstrap({ load, run });
        bootstrap.armOn(webContents);

        webContents.emit('did-start-loading');
        webContents.emit('did-start-loading');
        const explicit = bootstrap.trigger();
        const outcome = await explicit;

        expect(load).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual({ module: fakeModule, result: 'once' });
        await expect(bootstrap.trigger()).resolves.toBe(outcome);
    });

    it('falls back to the explicit trigger when no window is available', async () => {
        const sources: string[] = [];
        const bootstrap = createDeferredBootstrap({
            load: loadResolved,
            run: () => undefined,
            onTrigger: (source) => sources.push(source),
        });

        bootstrap.armOn(null);
        bootstrap.armOn(undefined);
        await bootstrap.trigger();

        expect(sources).toEqual(['explicit']);
    });

    it('reports the trigger source and the duration', async () => {
        const onTrigger = jest.fn();
        const onDone = jest.fn();
        const webContents = new EventEmitter();
        const bootstrap = createDeferredBootstrap({
            load: loadResolved,
            run: () => undefined,
            onTrigger,
            onDone,
        });
        bootstrap.armOn(webContents);

        webContents.emit('did-start-loading');
        await bootstrap.trigger();

        expect(onTrigger).toHaveBeenCalledTimes(1);
        expect(onTrigger).toHaveBeenCalledWith('did-start-loading');
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    });

    it('surfaces a failed load to every awaiting caller without running handlers', async () => {
        const run = jest.fn();
        const onError = jest.fn();
        const bootstrap = createDeferredBootstrap({
            load: () => Promise.reject(new Error('chunk missing')),
            run,
            onError,
        });

        const first = bootstrap.trigger();
        const second = bootstrap.trigger();

        await expect(first).rejects.toThrow('chunk missing');
        await expect(second).rejects.toThrow('chunk missing');
        expect(run).not.toHaveBeenCalled();
        expect(bootstrap.module).toBeNull();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('reports a failure fired by the window event instead of leaving it unhandled', async () => {
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const onError = jest.fn();
            const webContents = new EventEmitter();
            const bootstrap = createDeferredBootstrap({
                load: loadResolved,
                run: () => {
                    throw new Error('handler registration failed');
                },
                onError,
            });
            bootstrap.armOn(webContents);

            webContents.emit('did-start-loading');
            await macrotask();
            await macrotask();

            expect(onError).toHaveBeenCalledTimes(1);
            expect(unhandled).not.toHaveBeenCalled();
            // A later awaiting caller still sees the failure.
            await expect(bootstrap.trigger()).rejects.toThrow(
                'handler registration failed'
            );
            expect(onError).toHaveBeenCalledTimes(1);
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});

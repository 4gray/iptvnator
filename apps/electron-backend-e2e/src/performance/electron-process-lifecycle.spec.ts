import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import {
    closeElectronApplicationAndConfirmExit,
    ElectronApplicationDisposalError,
    prepareElectronApplication,
} from '../electron-process-lifecycle';

class FakeChildProcess extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    killCalls = 0;
    shouldExitOnKill = true;

    kill(): boolean {
        this.killCalls += 1;
        if (this.shouldExitOnKill) {
            this.signalCode = 'SIGTERM';
            queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
        }
        return true;
    }
}

describe('Electron process lifecycle', () => {
    it('closes and confirms exit when post-spawn launch preparation fails', async () => {
        const child = new FakeChildProcess();
        const launchFailure = new Error('renderer readiness failed');
        let closeCalls = 0;
        const application = {
            close: async () => {
                closeCalls += 1;
                child.exitCode = 0;
                child.emit('exit', 0, null);
            },
            process: () => child,
        };

        await assert.rejects(
            prepareElectronApplication({
                application,
                dispose: (app) =>
                    closeElectronApplicationAndConfirmExit(app, {
                        closeTimeoutMs: 10,
                        exitTimeoutMs: 10,
                    }),
                prepare: async () => {
                    throw launchFailure;
                },
            }),
            (error: unknown) => error === launchFailure
        );
        assert.equal(closeCalls, 1);
        assert.equal(child.exitCode, 0);
    });

    it('fails when process exit remains unconfirmed after forced teardown', async () => {
        const child = new FakeChildProcess();
        child.shouldExitOnKill = false;
        const application = {
            close: () => new Promise<void>(() => undefined),
            process: () => child,
        };

        await assert.rejects(
            closeElectronApplicationAndConfirmExit(application, {
                closeTimeoutMs: 1,
                exitTimeoutMs: 1,
            }),
            /electron-process-exit-unconfirmed/
        );
        assert.equal(child.killCalls, 1);
    });

    it('preserves both preparation and unconfirmed-disposal failures', async () => {
        const preparationFailure = new Error('renderer readiness failed');
        const disposalFailure = new Error('electron-process-exit-unconfirmed');

        await assert.rejects(
            prepareElectronApplication({
                application: {},
                dispose: async () => {
                    throw disposalFailure;
                },
                prepare: async () => {
                    throw preparationFailure;
                },
            }),
            (error: unknown) =>
                error instanceof ElectronApplicationDisposalError &&
                error.cause === preparationFailure &&
                error.errors.includes(disposalFailure)
        );
    });

    it('observes process exit promptly even when Playwright close never settles', async () => {
        const child = new FakeChildProcess();
        const application = {
            close: () => {
                queueMicrotask(() => {
                    child.exitCode = 0;
                    child.emit('exit', 0, null);
                });
                return new Promise<void>(() => undefined);
            },
            process: () => child,
        };

        await Promise.race([
            closeElectronApplicationAndConfirmExit(application, {
                closeTimeoutMs: 1_000,
                exitTimeoutMs: 10,
            }),
            new Promise<never>((_, rejectPromise) => {
                setTimeout(
                    () => rejectPromise(new Error('exit-observation-delayed')),
                    50
                );
            }),
        ]);
        assert.equal(child.killCalls, 0);
    });

    it('confirms the exit caused by forced teardown', async () => {
        const child = new FakeChildProcess();
        const application = {
            close: () => new Promise<void>(() => undefined),
            process: () => child,
        };

        await closeElectronApplicationAndConfirmExit(application, {
            closeTimeoutMs: 1,
            exitTimeoutMs: 10,
        });
        assert.equal(child.killCalls, 1);
        assert.equal(child.signalCode, 'SIGTERM');
    });
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import {
    closeElectronApp,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';

import {
    closeElectronApplicationAndConfirmExit as closeApplication,
    ElectronApplicationDisposalError,
    prepareElectronApplication,
} from '../electron-process-lifecycle';

// Fake children have no OS PID; exercise lifecycle decisions independently
// of the platform process-tree integration test.
const closeElectronApplicationAndConfirmExit: typeof closeApplication = (
    app,
    options
) =>
    closeApplication(app, options, (child, signal) => {
        child.kill(signal);
    });

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
    it('confirms an already exited process after Playwright disposes its dispatcher', async () => {
        const child = new FakeChildProcess();
        child.exitCode = 0;
        const app = {
            electronProcess: child,
            electronApp: {
                close: async () => {
                    assert.fail(
                        'an exited application must not be closed again'
                    );
                },
                process: () => {
                    throw new TypeError(
                        "Cannot read properties of undefined (reading '_object')"
                    );
                },
            },
        } as unknown as LaunchedElectronApp;

        await closeElectronApp(app);
        assert.equal(child.killCalls, 0);
    });

    it('does not return from public cleanup when close and termination both fail', async () => {
        const child = new FakeChildProcess();
        child.kill = () => {
            throw new Error('termination failed');
        };
        const app = {
            electronProcess: child,
            electronApp: {
                close: async () => {
                    throw new Error('CDP disconnected');
                },
                process: () => {
                    assert.fail('cleanup must use the retained child process');
                },
            },
        } as unknown as LaunchedElectronApp;

        await assert.rejects(
            closeElectronApp(app),
            /electron-process-exit-unconfirmed/
        );
    });
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
                        childProcess: child,
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

    it('preserves preparation failure when Electron has already exited', async () => {
        const child = new FakeChildProcess();
        const launchFailure = new Error('renderer closed before readiness');
        const application = {
            close: async () => {
                assert.fail('an exited application must not be closed again');
            },
            process: () => {
                assert.fail('the Playwright dispatcher is already disposed');
            },
        };

        await assert.rejects(
            prepareElectronApplication({
                application,
                dispose: (app) =>
                    closeElectronApplicationAndConfirmExit(app, {
                        childProcess: child,
                        closeTimeoutMs: 10,
                        exitTimeoutMs: 10,
                    }),
                prepare: async () => {
                    child.exitCode = 0;
                    throw launchFailure;
                },
            }),
            (error: unknown) => error === launchFailure
        );
        assert.equal(child.killCalls, 0);
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
                childProcess: child,
                closeTimeoutMs: 1,
                exitTimeoutMs: 1,
            }),
            /electron-process-exit-unconfirmed/
        );
        assert.equal(child.killCalls, 2);
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
                childProcess: child,
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
            childProcess: child,
            closeTimeoutMs: 1,
            exitTimeoutMs: 10,
        });
        assert.equal(child.killCalls, 1);
        assert.equal(child.signalCode, 'SIGTERM');
    });

    it('still observes exit after the first termination attempt throws', async () => {
        const child = new FakeChildProcess();
        const signals: NodeJS.Signals[] = [];
        await closeApplication(
            {
                close: () => new Promise<void>(() => undefined),
            },
            { childProcess: child, closeTimeoutMs: 1, exitTimeoutMs: 1 },
            (_child, signal) => {
                signals.push(signal);
                if (signal === 'SIGTERM') throw new Error('termination failed');
                child.kill();
            }
        );
        assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
        assert.equal(child.signalCode, 'SIGTERM');
    });
});

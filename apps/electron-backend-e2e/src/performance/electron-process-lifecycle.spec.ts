import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import {
    closeElectronApp,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';

import {
    captureElectronProcess,
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
    it('rejects cleanup when no process was captured for that application', async () => {
        await assert.rejects(
            closeApplication(
                { close: async () => assert.fail('exit cannot be confirmed') },
                { closeTimeoutMs: 1, exitTimeoutMs: 1 }
            ),
            /electron-process-handle-not-captured/
        );
    });

    it('cleans the replacement application after a partial restart assignment', async () => {
        const oldChild = new FakeChildProcess();
        const newChild = new FakeChildProcess();
        const oldApplication = {
            close: async () => {
                oldChild.exitCode = 0;
                oldChild.emit('exit', 0, null);
            },
            process: () => oldChild,
        };
        const newApplication = {
            close: async () => {
                newChild.exitCode = 0;
                newChild.emit('exit', 0, null);
            },
            process: () => newChild,
        };
        const app = {
            electronApp: oldApplication,
        } as unknown as LaunchedElectronApp;
        captureElectronProcess(oldApplication);
        captureElectronProcess(newApplication);
        await closeElectronApp(app);
        // Existing E2E callers replace the application/window fields only.
        app.electronApp =
            newApplication as unknown as LaunchedElectronApp['electronApp'];

        await closeElectronApp(app);
        assert.equal(newChild.exitCode, 0);
    });

    it('confirms an already exited process after Playwright disposes its dispatcher', async () => {
        const child = new FakeChildProcess();
        const app = {
            electronApp: {
                close: async () => {
                    assert.fail(
                        'an exited application must not be closed again'
                    );
                },
                process: () => child,
            },
        } as unknown as LaunchedElectronApp;

        captureElectronProcess(app.electronApp);
        child.exitCode = 0;
        app.electronApp.process = () => {
            throw new TypeError(
                "Cannot read properties of undefined (reading '_object')"
            );
        };
        await closeElectronApp(app);
        assert.equal(child.killCalls, 0);
    });

    it('does not return from public cleanup when close and termination both fail', async () => {
        const child = new FakeChildProcess();
        child.kill = () => {
            throw new Error('termination failed');
        };
        const app = {
            electronApp: {
                close: async () => {
                    throw new Error('CDP disconnected');
                },
                process: () => child,
            },
        } as unknown as LaunchedElectronApp;

        captureElectronProcess(app.electronApp);
        app.electronApp.process = () => {
            assert.fail('cleanup must use the retained child process');
        };
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
        captureElectronProcess(application);

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

    it('preserves preparation failure when Electron has already exited', async () => {
        const child = new FakeChildProcess();
        const launchFailure = new Error('renderer closed before readiness');
        const application = {
            close: async () => {
                assert.fail('an exited application must not be closed again');
            },
            process: () => child,
        };
        captureElectronProcess(application);

        await assert.rejects(
            prepareElectronApplication({
                application,
                dispose: (app) =>
                    closeElectronApplicationAndConfirmExit(app, {
                        closeTimeoutMs: 10,
                        exitTimeoutMs: 10,
                    }),
                prepare: async () => {
                    child.exitCode = 0;
                    application.process = () => {
                        assert.fail(
                            'the Playwright dispatcher is already disposed'
                        );
                    };
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
        captureElectronProcess(application);

        await assert.rejects(
            closeElectronApplicationAndConfirmExit(application, {
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
        captureElectronProcess(application);

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
        captureElectronProcess(application);

        await closeElectronApplicationAndConfirmExit(application, {
            closeTimeoutMs: 1,
            exitTimeoutMs: 10,
        });
        assert.equal(child.killCalls, 1);
        assert.equal(child.signalCode, 'SIGTERM');
    });

    it('still observes exit after the first termination attempt throws', async () => {
        const child = new FakeChildProcess();
        const signals: NodeJS.Signals[] = [];
        const application = {
            close: () => new Promise<void>(() => undefined),
            process: () => child,
        };
        captureElectronProcess(application);
        await closeApplication(
            application,
            { closeTimeoutMs: 1, exitTimeoutMs: 1 },
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

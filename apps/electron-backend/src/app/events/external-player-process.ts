import type { ChildProcess } from 'child_process';

const TERMINATION_GRACE_PERIOD_MS = 3_000;
const FORCED_TERMINATION_WAIT_MS = 2_000;

interface TerminateExternalPlayerProcessOptions {
    sendTerminationSignal?: boolean;
}

const EXTERNAL_PLAYER_TEARDOWN_PENDING_ERROR =
    'Cannot launch player because the previous external player is still shutting down';

/**
 * Serializes replacement launches against exact children whose exit has not
 * been confirmed. `ChildProcess.killed` only means a signal was sent, so it is
 * deliberately not used as a release condition.
 */
export class ExternalPlayerProcessTeardownGate {
    private readonly pending = new Map<ChildProcess, () => void>();

    assertLaunchAllowed(): void {
        for (const child of this.pending.keys()) {
            if (hasExited(child)) {
                this.release(child);
            }
        }

        if (this.pending.size > 0) {
            throw new Error(EXTERNAL_PLAYER_TEARDOWN_PENDING_ERROR);
        }
    }

    /**
     * Guard replacement launches before a potentially slow protocol-level
     * quit command is dispatched. `terminate()` keeps using the same exact
     * child registration once that command completes or fails.
     */
    beginTeardown(child: ChildProcess): void {
        this.track(child);
    }

    async terminate(
        child: ChildProcess,
        options: TerminateExternalPlayerProcessOptions = {}
    ): Promise<void> {
        this.track(child);
        try {
            await terminateExternalPlayerProcess(child, options);
        } finally {
            if (hasExited(child)) {
                this.release(child);
            }
        }
    }

    terminateInBackground(child: ChildProcess): void {
        void this.terminate(child).catch(() => {
            // The child remains registered until an exact exit/close event.
            // A later launch therefore still fails closed.
        });
    }

    private track(child: ChildProcess): void {
        if (hasExited(child) || this.pending.has(child)) {
            return;
        }

        const release = () => this.release(child);
        this.pending.set(child, release);
        child.once('exit', release);
        child.once('close', release);
    }

    private release(child: ChildProcess): void {
        const release = this.pending.get(child);
        if (!release) {
            return;
        }

        child.off('exit', release);
        child.off('close', release);
        this.pending.delete(child);
    }
}

export const externalPlayerProcessTeardownGate =
    new ExternalPlayerProcessTeardownGate();

/**
 * Resolves only after the exact child has stopped. A sent termination signal
 * is not itself proof that a replacement can be started safely.
 */
export function waitForExternalPlayerProcessExit(
    child: ChildProcess
): Promise<void> {
    if (hasExited(child)) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const complete = () => {
            child.off('exit', complete);
            child.off('close', complete);
            resolve();
        };
        child.once('exit', complete);
        child.once('close', complete);
    });
}

export async function terminateExternalPlayerProcess(
    child: ChildProcess,
    options: TerminateExternalPlayerProcessOptions = {}
): Promise<void> {
    if (hasExited(child)) {
        return;
    }

    if (
        options.sendTerminationSignal !== false &&
        !hasExited(child) &&
        !child.killed
    ) {
        try {
            child.kill();
        } catch {
            // The forced termination attempt below still gets a chance to
            // confirm that the exact child stopped.
        }
    }

    if (
        await waitForExternalPlayerProcessExitWithin(
            child,
            TERMINATION_GRACE_PERIOD_MS
        )
    ) {
        return;
    }

    try {
        child.kill('SIGKILL');
    } catch {
        // Keep waiting for the bounded confirmation window. If the child does
        // not report exit, reject so callers cannot launch a replacement.
    }

    if (
        await waitForExternalPlayerProcessExitWithin(
            child,
            FORCED_TERMINATION_WAIT_MS
        )
    ) {
        return;
    }

    throw new Error('External player process did not exit');
}

function waitForExternalPlayerProcessExitWithin(
    child: ChildProcess,
    timeoutMs: number
): Promise<boolean> {
    if (hasExited(child)) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const complete = (exited: boolean) => {
            child.off('exit', onExit);
            child.off('close', onExit);
            if (timer) {
                clearTimeout(timer);
            }
            resolve(exited);
        };
        const onExit = () => complete(true);

        child.once('exit', onExit);
        child.once('close', onExit);
        timer = setTimeout(() => complete(hasExited(child)), timeoutMs);
        timer.unref();
    });
}

function hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

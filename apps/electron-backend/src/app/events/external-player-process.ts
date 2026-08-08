import type { ChildProcess } from 'child_process';

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
            child.off('error', complete);
            resolve();
        };
        child.once('exit', complete);
        child.once('error', complete);
    });
}

export function terminateExternalPlayerProcess(
    child: ChildProcess
): Promise<void> {
    const exited = waitForExternalPlayerProcessExit(child);
    if (!hasExited(child) && !child.killed) {
        try {
            child.kill();
        } catch {
            // Keep waiting: failing closed prevents a replacement launch from
            // overlapping a child whose teardown could not be confirmed.
        }
    }
    return exited;
}

function hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

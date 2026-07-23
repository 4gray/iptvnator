import type { ChildProcess } from 'node:child_process';

const ACTIVE_VLC_PROCESSES = new Set<ChildProcess>();

process.once('exit', () => {
    for (const child of ACTIVE_VLC_PROCESSES) {
        try {
            child.kill('SIGKILL');
        } catch {
            // The operating system may already have reaped the child.
        }
    }
});

export function trackVlcProcess(child: ChildProcess): void {
    ACTIVE_VLC_PROCESSES.add(child);
}

export function untrackVlcProcess(child: ChildProcess): void {
    ACTIVE_VLC_PROCESSES.delete(child);
}

export function formatProcessExitReason(
    code: number | null,
    signal: NodeJS.Signals | null
): string {
    return signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
}

export function waitForProcessSpawn(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleSpawn = () => resolve();
        const handleError = (error: Error) => {
            child.removeListener('spawn', handleSpawn);
            reject(
                new Error(`Failed to start VLC recording: ${error.message}`)
            );
        };
        child.once('spawn', handleSpawn);
        child.once('error', handleError);
    });
}

export function stopVlcProcess(
    child: ChildProcess,
    timeoutMs: number
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let forceKillStarted = false;
        let exitAfterKillTimer: ReturnType<typeof setTimeout> | undefined;
        const stdin = child.stdin;
        const removeStdinErrorListener = () => {
            stdin?.removeListener('error', handleStdinError);
        };
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(forceKillTimer);
            if (exitAfterKillTimer) clearTimeout(exitAfterKillTimer);
            child.removeListener('exit', handleExit);
            removeStdinErrorListener();
            if (error) reject(error);
            else resolve();
        };
        const forceKill = () => {
            if (forceKillStarted || settled) return;
            forceKillStarted = true;
            clearTimeout(forceKillTimer);
            try {
                if (!child.kill('SIGKILL')) {
                    finish(
                        new Error('VLC recording process could not be killed')
                    );
                    return;
                }
                exitAfterKillTimer = setTimeout(() => {
                    if (child.exitCode === null) {
                        finish(
                            new Error(
                                'VLC recording process did not exit after SIGKILL'
                            )
                        );
                    } else {
                        finish();
                    }
                }, 1_000);
            } catch (error) {
                finish(
                    error instanceof Error
                        ? error
                        : new Error('VLC recording process could not be killed')
                );
            }
        };
        const requestSignalStop = () => {
            try {
                if (
                    !child.kill(
                        process.platform === 'win32' ? 'SIGTERM' : 'SIGINT'
                    )
                ) {
                    forceKill();
                }
            } catch {
                forceKill();
            }
        };
        function handleStdinError(): void {
            requestSignalStop();
        }
        function handleExit(): void {
            finish();
        }
        const forceKillTimer = setTimeout(() => {
            if (child.exitCode === null) {
                forceKill();
                return;
            }
            finish();
        }, timeoutMs);

        child.once('exit', handleExit);
        try {
            if (stdin?.writable) {
                stdin.once('error', handleStdinError);
                stdin.write('quit\n');
                stdin.end();
            } else requestSignalStop();
        } catch {
            requestSignalStop();
        }
    });
}

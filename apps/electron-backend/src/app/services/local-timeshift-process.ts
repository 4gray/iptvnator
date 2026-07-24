import type { ChildProcess } from 'node:child_process';
import type { ActiveLocalTimeshiftSession } from './local-timeshift-state';

export function observeLocalTimeshiftProcess(
    session: ActiveLocalTimeshiftSession,
    child: ChildProcess,
    onUnexpectedExit: (error: Error) => void
): void {
    let observed = false;
    const finish = (error: Error) => {
        if (observed) return;
        observed = true;
        session.processEnded = true;
        session.resolveProcessFailure(error);
        if (session.ready && !session.stopping) onUnexpectedExit(error);
    };
    child.once('error', () =>
        finish(new Error('FFmpeg timeshift process failed to start'))
    );
    child.once('exit', (code, signal) =>
        finish(
            new Error(
                `FFmpeg timeshift process exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`})`
            )
        )
    );
}

export async function waitForLocalTimeshiftProcessSpawn(
    child: ChildProcess,
    processFailure: Promise<Error>
): Promise<void> {
    const spawned = new Promise<void>((resolve) =>
        child.once('spawn', resolve)
    );
    await Promise.race([
        spawned,
        processFailure.then((error) => Promise.reject(error)),
    ]);
}

export function terminateLocalTimeshiftProcess(
    child: ChildProcess,
    gracefulTimeoutMs: number
): Promise<void> {
    if (child.exitCode !== null) return Promise.resolve();

    return new Promise((resolve, reject) => {
        let settled = false;
        let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(gracefulTimer);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            child.removeListener('exit', handleExit);
            if (error) reject(error);
            else resolve();
        };
        const handleExit = () => finish();
        const forceKill = () => {
            try {
                if (child.exitCode !== null) {
                    finish();
                    return;
                }
                if (!child.kill('SIGKILL')) {
                    finish(
                        new Error(
                            'FFmpeg timeshift process could not be killed'
                        )
                    );
                    return;
                }
                forceKillTimer = setTimeout(() => {
                    if (child.exitCode === null) {
                        finish(
                            new Error(
                                'FFmpeg timeshift process did not exit after SIGKILL'
                            )
                        );
                    } else {
                        finish();
                    }
                }, 1_000);
                forceKillTimer.unref?.();
            } catch {
                finish(
                    new Error('FFmpeg timeshift process could not be killed')
                );
            }
        };
        const gracefulTimer = setTimeout(forceKill, gracefulTimeoutMs);
        gracefulTimer.unref?.();
        child.once('exit', handleExit);
        try {
            if (!child.kill('SIGTERM')) forceKill();
        } catch {
            forceKill();
        }
    });
}

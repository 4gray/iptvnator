import { execFileSync, type ChildProcess } from 'node:child_process';

type ElectronProcess = Pick<ChildProcess, 'pid' | 'kill'>;

export function terminateElectronProcess(
    child: ElectronProcess,
    signal: NodeJS.Signals = 'SIGTERM',
    platform: NodeJS.Platform = process.platform,
    run: typeof execFileSync = execFileSync
): void {
    // Playwright launches Electron through cmd.exe on Windows. Killing only
    // that ChildProcess leaves Electron (and its profile lock) alive.
    if (platform === 'win32') {
        if (!Number.isSafeInteger(child.pid) || (child.pid ?? 0) <= 0) {
            throw new Error('electron-process-pid-unavailable');
        }
        run('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'pipe',
            timeout: 5000,
            windowsHide: true,
        });
        return;
    }
    child.kill(signal);
}

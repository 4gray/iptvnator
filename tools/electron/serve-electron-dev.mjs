import { spawn } from 'node:child_process';
import {
    assertPortAvailable,
    coordinateChildProcesses,
    waitForIptvnatorWebServer,
} from './serve-electron-dev.runtime.mjs';

const WEB_URL = new URL('http://localhost:4200/');
const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) {
    throw new Error('Unable to locate the workspace package manager CLI.');
}

await assertPortAvailable(Number(WEB_URL.port));

const childOptions = {
    stdio: 'inherit',
    windowsHide: true,
};
const webChild = spawn(
    process.execPath,
    [packageManagerCli, 'nx', 'serve', 'web', '--no-tui'],
    childOptions
);

try {
    await waitForIptvnatorWebServer(WEB_URL, webChild);
} catch (error) {
    webChild.kill('SIGTERM');
    throw error;
}

const electronChild = spawn(
    process.execPath,
    [packageManagerCli, 'nx', 'run', 'electron-backend:serve-electron'],
    childOptions
);

coordinateChildProcesses(webChild, electronChild);

import { spawn } from 'node:child_process';
import { request } from 'node:http';

const WEB_URL = new URL('http://localhost:4200/');
const STARTUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

await waitForWebServer();

const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) {
    throw new Error('Unable to locate the workspace package manager CLI.');
}

const child = spawn(
    process.execPath,
    [packageManagerCli, 'nx', 'run', 'electron-backend:serve-electron'],
    {
        stdio: 'inherit',
        windowsHide: true,
    }
);

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        child.kill(signal);
    });
}

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exitCode = code ?? 1;
});

function waitForWebServer() {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    return new Promise((resolveReady, reject) => {
        const check = () => {
            const req = request(WEB_URL, { method: 'HEAD' }, (response) => {
                response.resume();
                resolveReady();
            });
            req.setTimeout(2_000, () => req.destroy());
            req.on('error', () => {
                if (Date.now() >= deadline) {
                    reject(
                        new Error(
                            `Web development server did not start within ${STARTUP_TIMEOUT_MS} ms.`
                        )
                    );
                    return;
                }
                setTimeout(check, POLL_INTERVAL_MS);
            });
            req.end();
        };

        check();
    });
}

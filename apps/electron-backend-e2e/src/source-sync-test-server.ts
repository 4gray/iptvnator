import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { workspaceRoot } from './electron-test-fixtures';

/** A real, isolated NAS backend; never connects to a developer's source data. */
export async function startSourceSyncServer(token = '') {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-sync-server-'));
    const port = process.env['SOURCE_SYNC_PORT'] ?? '3347';
    const apiUrl = `http://127.0.0.1:${port}`;
    const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'apps/web-backend/src/main.ts'],
        {
            cwd: workspaceRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PORT: port,
                CLIENT_URL: `http://localhost:${process.env['SOURCE_SYNC_WEB_PORT'] ?? '4307'}`,
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_DATA_DIR: directory,
                IPTVNATOR_ACCESS_TOKEN: token,
                IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS: '1',
                TSX_TSCONFIG_PATH: 'tsconfig.base.json',
            },
        }
    );
    let output = '';
    child.stdout.on('data', (data) => {
        output += data.toString();
    });
    child.stderr.on('data', (data) => {
        output += data.toString();
    });
    try {
        await expect
            .poll(
                async () => {
                    if (child.exitCode !== null)
                        throw new Error(`Test backend exited: ${output}`);
                    try {
                        return (await fetch(`${apiUrl}/health`)).status;
                    } catch {
                        return 0;
                    }
                },
                { timeout: 20000 }
            )
            .toBe(200);
    } catch (error) {
        child.kill('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }
    let closing: Promise<void> | undefined;
    return {
        apiUrl,
        close: () =>
            (closing ??= (async () => {
                if (child.exitCode === null && child.signalCode === null)
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(
                            () => child.kill('SIGKILL'),
                            5000
                        );
                        child.once('exit', () => {
                            clearTimeout(timer);
                            resolve();
                        });
                        child.kill('SIGTERM');
                    });
                rmSync(directory, { recursive: true, force: true });
            })()),
    };
}

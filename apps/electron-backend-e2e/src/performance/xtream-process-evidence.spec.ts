import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { ElectronApplication } from '@playwright/test';

import {
    captureXtreamLaunchIdentity,
    createXtreamIterationProcessEvidence,
} from './xtream-process-evidence';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
});

describe('Xtream process evidence', () => {
    it('proves the Electron child and evaluated main PID are identical and fresh', async () => {
        const seen = new Set<number>();
        const first = await captureXtreamLaunchIdentity(
            electronApp(41_001),
            41_001,
            seen,
            () => '00000000-0000-4000-8000-000000000001'
        );
        const second = await captureXtreamLaunchIdentity(
            electronApp(41_002),
            41_002,
            seen,
            () => '00000000-0000-4000-8000-000000000002'
        );

        assert.deepEqual(first, {
            electronPid: 41_001,
            launchId: 'launch-00000000-0000-4000-8000-000000000001',
        });
        assert.equal(second.electronPid, 41_002);
        assert.deepEqual([...seen], [41_001, 41_002]);
        await assert.rejects(
            () =>
                captureXtreamLaunchIdentity(electronApp(41_001), 41_001, seen),
            /xtream-electron-process-identity-invalid/
        );
    });

    it('rejects a launcher PID that differs from the Electron main process', async () => {
        await assert.rejects(
            () =>
                captureXtreamLaunchIdentity(
                    electronApp(41_002),
                    41_001,
                    new Set()
                ),
            /xtream-electron-process-identity-invalid/
        );
    });

    it('hashes the canonical iteration directory outside diagnostics', async () => {
        const root = await temporaryDirectory();
        const iterationDirectory = join(root, 'run-01');
        await mkdir(iterationDirectory);

        const evidence = await createXtreamIterationProcessEvidence({
            diagnosticDirectorySha256: null,
            electronPid: 41_001,
            iterationDirectory,
            launchId: 'launch-00000000-0000-4000-8000-000000000001',
        });

        assert.equal(evidence.freshProcessVerified, true);
        assert.match(evidence.profileDirectorySha256, /^[a-f0-9]{64}$/u);
    });

    it('uses validated diagnostic directory evidence verbatim', async () => {
        const root = await temporaryDirectory();
        const iterationDirectory = join(root, 'diagnostic');
        await mkdir(iterationDirectory);
        const directorySha256 = 'a'.repeat(64);

        const evidence = await createXtreamIterationProcessEvidence({
            diagnosticDirectorySha256: directorySha256,
            electronPid: 41_001,
            iterationDirectory,
            launchId: 'launch-00000000-0000-4000-8000-000000000001',
        });

        assert.equal(evidence.profileDirectorySha256, directorySha256);
    });
});

function electronApp(pid: number): ElectronApplication {
    return {
        evaluate: async () => pid,
    } as unknown as ElectronApplication;
}

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-xtream-process-evidence-')
    );
    directories.push(directory);
    return directory;
}

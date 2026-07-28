import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    dataDirHardMaxAgeMs,
    dataDirOwnerMarker,
    dataDirPrefix,
    orphanDataDirMaxAgeMs,
    readDataDirOwner,
    reapOrphanedDataDirs,
    writeDataDirOwnerMarker,
} from './data-dir-reaper';

/**
 * Coverage for the orphaned-data-directory sweep.
 *
 * These are filesystem-level rather than app-level, but they belong in the
 * Electron suite: it runs on Linux, macOS and Windows, and the sweep turns on
 * `process.kill(pid, 0)` semantics that differ per platform.
 */
const roots: string[] = [];
const children: ChildProcess[] = [];

function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'reaper-spec-'));
    roots.push(root);
    return root;
}

/** A data directory shaped like a real one, optionally aged and/or owned. */
function makeDataDir(
    root: string,
    name: string,
    options: { ageHours?: number; pid?: number | string } = {}
): string {
    const dir = join(root, `${dataDirPrefix}${name}`);
    mkdirSync(join(dir, 'databases'), { recursive: true });
    writeFileSync(join(dir, 'databases', 'iptvnator.db'), 'db');
    if (options.pid !== undefined) {
        writeFileSync(join(dir, dataDirOwnerMarker), String(options.pid));
    }
    if (options.ageHours !== undefined) {
        const when = new Date(Date.now() - options.ageHours * 3600_000);
        utimesSync(dir, when, when);
    }
    return dir;
}

function spawnLiveProcess(): ChildProcess {
    const child =
        process.platform === 'win32'
            ? spawn('cmd', ['/c', 'ping -n 30 127.0.0.1 > NUL'], {
                  stdio: 'ignore',
              })
            : spawn('sleep', ['30'], { stdio: 'ignore' });
    children.push(child);
    return child;
}

test.afterAll(() => {
    for (const child of children) {
        child.kill();
    }
    for (const root of roots) {
        rmSync(root, { force: true, recursive: true });
    }
});

test.describe('orphaned data directory reaper', () => {
    test('keeps a live owner well past the unmarked cutoff', () => {
        const root = makeRoot();
        const child = spawnLiveProcess();
        // Age is deliberately past the cutoff: writes land under databases/ and
        // never refresh the root's mtime, so a running suite can look this old.
        const dir = makeDataDir(root, 'live', {
            ageHours: 48,
            pid: child.pid,
        });

        reapOrphanedDataDirs(root);

        expect(existsSync(dir)).toBe(true);
    });

    test('reaps a live-looking owner once past the hard cap, since the pid must be recycled', () => {
        const root = makeRoot();
        // A pid that resolves to a live process, but on a directory far older
        // than any suite could run — so the pid belongs to a stranger now.
        const child = spawnLiveProcess();
        const dir = makeDataDir(root, 'recycled', {
            ageHours: 24 * 8,
            pid: child.pid,
        });

        expect(readDataDirOwner(dir)).toBe('alive');

        reapOrphanedDataDirs(root);

        expect(existsSync(dir)).toBe(false);
    });

    test('reaps a dead owner immediately, without waiting out the cutoff', async () => {
        const root = makeRoot();
        const child = spawnLiveProcess();
        const dir = makeDataDir(root, 'dead', {
            ageHours: 0,
            pid: child.pid,
        });

        child.kill('SIGKILL');
        // The pid only leaves the table once the parent reaps the exit status,
        // so wait for that rather than assuming kill() is synchronous.
        await expect
            .poll(() => readDataDirOwner(dir), { timeout: 10_000 })
            .toBe('dead');

        reapOrphanedDataDirs(root);

        expect(existsSync(dir)).toBe(false);
    });

    test('reaps an unmarked directory once it is past the cutoff', () => {
        const root = makeRoot();
        const dir = makeDataDir(root, 'legacy', { ageHours: 48 });

        reapOrphanedDataDirs(root);

        expect(existsSync(dir)).toBe(false);
    });

    test('keeps a fresh unmarked directory', () => {
        const root = makeRoot();
        const dir = makeDataDir(root, 'fresh', { ageHours: 1 });

        reapOrphanedDataDirs(root);

        expect(existsSync(dir)).toBe(true);
    });

    test('treats an empty or malformed marker as undeterminable, not dead', () => {
        const root = makeRoot();
        // A half-written marker must not bypass the age guard and take out a
        // suite that is still starting up.
        const empty = makeDataDir(root, 'empty', { ageHours: 1, pid: '' });
        const partial = makeDataDir(root, 'partial', {
            ageHours: 1,
            pid: 'not-a-pid',
        });

        expect(readDataDirOwner(empty)).toBe('unknown');
        expect(readDataDirOwner(partial)).toBe('unknown');

        reapOrphanedDataDirs(root);

        expect(existsSync(empty)).toBe(true);
        expect(existsSync(partial)).toBe(true);
    });

    test('publishes the owner marker atomically', () => {
        const root = makeRoot();
        const dir = makeDataDir(root, 'atomic', { ageHours: 0 });

        writeDataDirOwnerMarker(dir);

        // No `.pending` residue, and the marker resolves to this live process.
        expect(existsSync(`${join(dir, dataDirOwnerMarker)}.pending`)).toBe(
            false
        );
        expect(readDataDirOwner(dir)).toBe('alive');
    });

    test('ignores directories that do not carry the suite prefix', () => {
        const root = makeRoot();
        const foreign = join(root, 'some-other-tool-XYZ');
        mkdirSync(foreign, { recursive: true });
        const when = new Date(Date.now() - 99 * 3600_000);
        utimesSync(foreign, when, when);

        reapOrphanedDataDirs(root);

        expect(existsSync(foreign)).toBe(true);
    });

    test('survives a missing root instead of throwing', () => {
        expect(() =>
            reapOrphanedDataDirs(join(tmpdir(), 'reaper-spec-does-not-exist'))
        ).not.toThrow();
    });

    test('cutoffs are a day and a week, and the hard cap is the looser one', () => {
        expect(orphanDataDirMaxAgeMs).toBe(24 * 60 * 60 * 1000);
        expect(dataDirHardMaxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
        expect(dataDirHardMaxAgeMs).toBeGreaterThan(orphanDataDirMaxAgeMs);
    });
});

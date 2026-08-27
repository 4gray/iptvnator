/**
 * CLI-level tests for build-release-notes.mjs.
 *
 * The script parses its arguments and runs on import, so these drive the real
 * entry point in a subprocess rather than importing parseArgs directly.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const CLI = path.join(workspaceRoot, 'tools/release/build-release-notes.mjs');
const tempDirs = [];

/** A notes directory holding one valid note, so runs have something to render. */
function makeNotesDir() {
    const directory = mkdtempSync(path.join(tmpdir(), 'release-cli-'));
    tempDirs.push(directory);

    writeFileSync(
        path.join(directory, 'playback-example.md'),
        '---\ntype: feature\narea: playback\n---\n\nAn example note.\n',
        'utf8'
    );

    return directory;
}

/**
 * spawnSync rather than execFileSync: a successful run also writes to stderr
 * (the resolved-version notice, the internal-only announcement explanation),
 * and execFileSync only hands back stdout.
 *
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runCli(args) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

after(() => {
    for (const directory of tempDirs) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('build-release-notes CLI arguments', () => {
    it('validates a notes directory', () => {
        const result = runCli(['--validate', '--dir', makeNotesDir()]);

        assert.equal(result.status, 0);
        assert.match(result.stdout, /1 release note\(s\) valid\./);
    });

    it('ignores a bare `--` separator', () => {
        // pnpm forwards `--` to the script instead of consuming it, so the
        // npm-style `pnpm run release:notes:validate -- --dir x` reaches us
        // with the separator still attached.
        const result = runCli(['--validate', '--', '--dir', makeNotesDir()]);

        assert.equal(result.status, 0);
        assert.match(result.stdout, /1 release note\(s\) valid\./);
    });

    it('ignores a leading `--` separator', () => {
        const result = runCli(['--', '--validate', '--dir', makeNotesDir()]);

        assert.equal(result.status, 0);
        assert.match(result.stdout, /1 release note\(s\) valid\./);
    });

    it('renders the github body with a version passed after `--`', () => {
        const result = runCli([
            '--format',
            'github',
            '--',
            '--version',
            '0.24.0',
            '--dir',
            makeNotesDir(),
        ]);

        assert.equal(result.status, 0);
        assert.match(result.stdout, /## Features/);
        assert.match(result.stdout, /\*\*playback\*\* — An example note\./);
    });

    it('renders the telegram announcement to stdout', () => {
        const result = runCli([
            '--format',
            'telegram',
            '--version',
            '0.24.0',
            '--dir',
            makeNotesDir(),
        ]);

        assert.equal(result.status, 0);
        assert.match(result.stdout, /🎉 IPTVnator v0\.24\.0 is out!/);
        assert.match(result.stdout, /✨ An example note\./);
        assert.match(result.stdout, /releases\/tag\/v0\.24\.0/);
    });

    it('renders the reddit announcement to stdout', () => {
        const result = runCli([
            '--format',
            'reddit',
            '--version',
            '0.24.0',
            '--dir',
            makeNotesDir(),
        ]);

        assert.equal(result.status, 0);
        assert.match(result.stdout, /^Suggested title: IPTVnator v0\.24\.0/);
        assert.match(result.stdout, /- \*\*playback\*\* — An example note\./);
    });

    it('reports an internal-only release instead of failing on announcements', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'release-cli-'));

        tempDirs.push(directory);
        writeFileSync(
            path.join(directory, 'deps-bump.md'),
            '---\ntype: internal\narea: deps\n---\n\nBumped a parser.\n',
            'utf8'
        );

        for (const format of ['telegram', 'reddit']) {
            const result = runCli([
                '--format',
                format,
                '--version',
                '0.24.0',
                '--dir',
                directory,
            ]);

            assert.equal(result.status, 0, format);
            assert.equal(result.stdout, '', format);
            assert.match(result.stderr, /Internal-only release/, format);
        }
    });

    it('still rejects a genuinely unknown argument', () => {
        const result = runCli(['--validate', '--nope']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /unknown argument: --nope/);
    });

    it('still rejects a flag whose value is missing', () => {
        const result = runCli(['--format']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /--format requires a value/);
    });
});

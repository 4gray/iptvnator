import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    evaluateGate,
    GATE_LABEL,
} from './check-release-note-gate.mjs';

const gateScript = fileURLToPath(
    new URL('./check-release-note-gate.mjs', import.meta.url)
);

function file(filename, status = 'modified') {
    return { filename, status };
}

function gate(files, labels = []) {
    return evaluateGate({ files, labels });
}

describe('evaluateGate', () => {
    it('passes when runtime code ships with an added note', () => {
        const verdict = gate([
            file('libs/ui/playback/src/lib/player.ts'),
            file('.changes/playback-volume-memory.md', 'added'),
        ]);

        assert.equal(verdict.ok, true);
        assert.match(verdict.message, /playback-volume-memory/);
    });

    it('fails when runtime code ships without a note', () => {
        const verdict = gate([file('apps/web/src/app/app.component.ts')]);

        assert.equal(verdict.ok, false);
        assert.match(verdict.message, /app\.component\.ts/);
        assert.match(verdict.message, /\.changes\/<area>-<short-slug>\.md/);
        assert.match(verdict.message, new RegExp(GATE_LABEL));
    });

    it('accepts the escape label', () => {
        const verdict = gate(
            [file('apps/web/src/app/app.component.ts')],
            [GATE_LABEL]
        );

        assert.equal(verdict.ok, true);
    });

    it('a modified existing note does not satisfy the gate', () => {
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/old-note.md', 'modified'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('a renamed note does not satisfy the gate', () => {
        // A note added and renamed within one PR still reports as `added`;
        // `renamed` means it came from the base branch, i.e. another PR's.
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/m3u-better-name.md', 'renamed'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('a nested note does not satisfy the gate', () => {
        // loadNotes() only reads the immediate directory, so a nested file
        // would never be validated or rendered into a release surface.
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/subdir/m3u-note.md', 'added'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('accepts a top-level note regardless of surrounding path noise', () => {
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/m3u-long-urls.md', 'added'),
        ]);

        assert.equal(verdict.ok, true);
    });

    it('.changes/README.md is not a note', () => {
        const verdict = gate([
            file('libs/m3u-state/src/lib/reducer.ts'),
            file('.changes/README.md', 'added'),
        ]);

        assert.equal(verdict.ok, false);
    });

    it('ignores changes outside apps/ and libs/', () => {
        const verdict = gate([
            file('tools/release/build-release-notes.mjs'),
            file('.github/workflows/ci.yml'),
            file('AGENTS.md'),
            file('package.json'),
        ]);

        assert.equal(verdict.ok, true);
        assert.match(verdict.message, /not required/);
    });

    it('exempts tests, snapshots, e2e, website, mock servers and docs', () => {
        const verdict = gate([
            file('apps/web/src/app/app.component.spec.ts'),
            file('apps/web-e2e/src/xtream.e2e.ts'),
            file('apps/electron-backend-e2e/src/search.e2e.ts'),
            file('apps/website/src/pages/index.astro'),
            file('apps/xtream-mock-server/src/main.ts'),
            file('apps/stalker-mock-server/src/main.ts'),
            file('libs/shared/testing/src/lib/helpers.ts'),
            file('libs/ui/playback/src/lib/__snapshots__/player.snap'),
            file('libs/ui/playback/README.md'),
        ]);

        assert.equal(verdict.ok, true);
    });

    it('one runtime file among exempt ones still triggers the gate', () => {
        const verdict = gate([
            file('apps/web/src/app/app.component.spec.ts'),
            file('apps/web/src/app/app.component.ts'),
        ]);

        assert.equal(verdict.ok, false);
        assert.match(verdict.message, /app\.component\.ts/);
        assert.doesNotMatch(verdict.message, /spec\.ts/);
    });

    it('truncates long file listings in the failure message', () => {
        const files = Array.from({ length: 15 }, (_, index) =>
            file(`libs/services/src/lib/file-${index}.ts`)
        );
        const verdict = gate(files);

        assert.equal(verdict.ok, false);
        assert.match(verdict.message, /… and 5 more/);
    });
});

it('checks the tested merge paths and still reads the current exemption label', (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-note-gate-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const env = {
        ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
        ),
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
    };
    function git(...args) {
        const result = spawnSync(
            'git',
            ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
            { cwd: root, env, encoding: 'utf8' }
        );
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    }
    function check(labels, expected, message) {
        const result = spawnSync(process.execPath, [gateScript, '--merge-checkout'], {
            cwd: root,
            env,
            input: JSON.stringify(labels),
            encoding: 'utf8',
        });
        assert.equal(result.status, expected, result.stderr);
        assert.match(result.stdout, message);
    }

    git('init', '-b', 'master');
    for (const dir of ['.changes', 'docs', 'libs']) mkdirSync(path.join(root, dir));
    writeFileSync(path.join(root, '.changes/old.md'), 'Existing release note.');
    writeFileSync(path.join(root, 'libs/fixture.ts'), 'export const fixture = true;');
    git('add', '.');
    git('commit', '-m', 'base');
    git('switch', '-c', 'feature');
    renameSync(path.join(root, 'libs/fixture.ts'), path.join(root, 'docs/fixture.md'));
    renameSync(path.join(root, '.changes/old.md'), path.join(root, '.changes/renamed.md'));
    git('add', '.');
    git('commit', '-m', 'move runtime fixture and a pre-existing note');
    git('switch', 'master');
    git('merge', '--no-ff', 'feature');
    const testedMerge = git('rev-parse', 'HEAD');
    git('switch', 'feature');
    writeFileSync(path.join(root, '.changes/new.md'), 'New release note.');
    git('add', '.');
    git('commit', '-m', 'add a real note on the newer PR head');
    git('switch', '--detach', testedMerge);

    check([], 1, /libs\/fixture\.ts/);
    check([GATE_LABEL], 0, /no-release-note/);

    git('switch', 'master');
    git('reset', '--hard', 'HEAD^1');
    git('merge', '--no-ff', 'feature');
    check([], 0, /Release note present: \.changes\/new\.md/);
});

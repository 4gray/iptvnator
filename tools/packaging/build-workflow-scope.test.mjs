import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const buildWorkflowConfig = parse(
    fs.readFileSync(
        new URL('../../.github/workflows/build-and-make.yaml', import.meta.url),
        'utf8'
    )
);
const posixOnly = { skip: process.platform === 'win32' };

test(
    'only website changes in a PR merge tree can skip Electron packaging',
    posixOnly,
    (t) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-pr-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const repo = path.join(root, 'repo');
        fs.mkdirSync(path.join(repo, 'apps', 'website'), { recursive: true });
        const output = path.join(root, 'output');
        const env = {
            ...Object.fromEntries(
                Object.entries(process.env).filter(
                    ([key]) => !/^GIT_/i.test(key)
                )
            ),
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
        };
        const jobs = buildWorkflowConfig.jobs;
        const scopeJob = jobs['appstream-website'];
        const scope = scopeJob.steps.find((step) => step.id === 'scope');

        function git(...args) {
            const result = spawnSync(
                'git',
                [
                    '-c',
                    'user.name=Fixture',
                    '-c',
                    'user.email=fixture@example.test',
                    '-c',
                    'commit.gpgsign=false',
                    '-c',
                    'core.hooksPath=/dev/null',
                    ...args,
                ],
                { cwd: repo, encoding: 'utf8', env }
            );
            assert.equal(result.status, 0, result.stderr);
        }

        function check(expected) {
            fs.writeFileSync(output, '');
            const result = spawnSync('bash', ['-c', scope.run], {
                cwd: repo,
                encoding: 'utf8',
                env: {
                    ...env,
                    GITHUB_OUTPUT: output,
                    GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
                },
            });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(
                fs.readFileSync(output, 'utf8'),
                `website-only=${expected}\n`
            );
        }

        git('init', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'apps/website/page.astro'), 'before');
        fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), 'before');
        git('add', '.');
        git('commit', '-m', 'base');
        check(false); // A missing parent keeps packaging enabled.

        git('switch', '-c', 'site');
        fs.writeFileSync(path.join(repo, 'apps/website/page.astro'), 'after');
        git('commit', '-am', 'site change');
        git('switch', 'main');
        fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), 'updated on base');
        git('commit', '-am', 'base change');
        git('merge', '--no-ff', '--no-edit', 'site');
        check(true);

        git('mv', 'pnpm-lock.yaml', 'apps/website/moved.yaml');
        git('commit', '-m', 'move into site');
        check(false);

        assert.equal(scopeJob.if, "github.event_name == 'pull_request'");
        assert.equal(
            jobs['nightly-version'].if,
            "github.event_name != 'pull_request'"
        );
        assert.equal(scopeJob.steps[0].with['fetch-depth'], 2);
        assert.deepEqual(scopeJob.concurrency, {
            group: '${{ github.workflow }}-appstream-scope-${{ github.event.pull_request.number }}',
            'cancel-in-progress': true,
        });
        assert.equal(
            jobs['linux-embedded-mpv-runtime'].needs,
            'appstream-website'
        );
        for (const job of [
            jobs['linux-embedded-mpv-runtime'],
            jobs['build-cross-platform'],
        ]) {
            assert.match(job.if, /!cancelled\(\)/);
            assert.match(job.if, /github\.event_name != 'pull_request'/);
            assert.match(
                job.if,
                /needs\.appstream-website\.result == 'success'\s*&&\s*needs\.appstream-website\.outputs\.website-only != 'true'/
            );
        }
        // Skipped planning jobs must not propagate past successful builds.
        for (const id of ['build-linux', 'create-release']) {
            const job = jobs[id];
            assert.match(job.if, /!cancelled\(\)/);
            for (const need of job.needs) {
                assert.ok(
                    job.if.includes(`needs.${need}.result == 'success'`),
                    `${id} must require ${need} to succeed`
                );
            }
        }
    }
);

test(
    'standalone AppStream check rejects a missing or empty built screenshot',
    posixOnly,
    (t) => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), 'appstream-website-')
        );
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const output = path.join(root, 'dist/apps/website/appstream');
        fs.mkdirSync(output, { recursive: true });
        const job = buildWorkflowConfig.jobs['appstream-website'];
        const step = job.steps.find(
            ({ name }) => name === 'Verify built screenshots'
        );
        const packageStep = buildWorkflowConfig.jobs['build-linux'].steps.find(
            ({ name }) => name === 'Verify AppStream website assets'
        );
        assert.equal(packageStep.run, step.run);
        assert.equal(packageStep.if, "matrix.os == 'linux'");
        const verify = () =>
            spawnSync('bash', ['-c', step.run], {
                cwd: root,
                encoding: 'utf8',
            });
        for (const name of ['player', 'playlists', 'epg']) {
            fs.writeFileSync(path.join(output, `${name}.png`), 'fixture');
        }
        const missing = verify();
        assert.equal(missing.status, 1);
        assert.match(missing.stdout, /settings\.png/);

        fs.writeFileSync(path.join(output, 'settings.png'), '');
        assert.equal(verify().status, 1);
        fs.writeFileSync(path.join(output, 'settings.png'), 'fixture');
        assert.equal(verify().status, 0);
    }
);

test(
    'a superseded or closed PR cannot change the rolling draft',
    posixOnly,
    (t) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-head-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const output = path.join(root, 'output');
        const steps = buildWorkflowConfig.jobs['create-release'].steps;
        const guard = steps.find((step) => step.id === 'pr-state');
        const head = 'a'.repeat(40);
        const fixture = 'gh() { printf "%s\\n" "$FIXTURE_PR"; }\n';

        for (const [live, current] of [
            [`open ${head}`, true],
            [`open ${'b'.repeat(40)}`, false],
            [`closed ${head}`, false],
        ]) {
            fs.writeFileSync(output, '');
            const result = spawnSync('bash', ['-c', fixture + guard.run], {
                cwd: root,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    FIXTURE_PR: live,
                    GITHUB_OUTPUT: output,
                    GITHUB_REPOSITORY: 'fixture/project',
                    PR_NUMBER: '1',
                    HEAD_SHA: head,
                },
            });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(
                fs.readFileSync(output, 'utf8'),
                `current=${current}\n`
            );
        }
        for (const name of [
            'Prune stale draft assets',
            'Create Draft Release',
        ]) {
            assert.match(
                steps.find((step) => step.name === name).if,
                /steps\.pr-state\.outputs\.current == 'true'/
            );
        }
    }
);

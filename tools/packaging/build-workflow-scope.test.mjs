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
    'macOS ticket validation retries only a lost connection',
    posixOnly,
    (t) => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), 'stapler-validation-')
        );
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        fs.mkdirSync(path.join(root, 'dist/executables/mac/IPTVnator.app'), {
            recursive: true,
        });
        const step = buildWorkflowConfig.jobs[
            'build-cross-platform'
        ].steps.find(({ name }) => name === 'Verify signed macOS app');
        const stubs = `
        codesign() { echo "codesign $1"; }
        spctl() { echo "gatekeeper"; }
        sleep() { echo "wait $1"; }
        xattr() { :; }
        xcrun() {
            test "$*" = 'stapler validate dist/executables/mac/IPTVnator.app' || return 99
            echo attempt >> attempts
            if [ "$(wc -l < attempts)" -eq 1 ]; then
                echo "$STAPLER_ERROR" >&2
                return 68
            fi
            return "$STAPLER_RETRY_STATUS"
        }
    `;
        const script = step.run.replaceAll('${{ matrix.arch }}', 'x64');
        const connectionLost =
            'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."';
        for (const [error, retryStatus, expectedStatus, attempts] of [
            [connectionLost, 0, 0, 2],
            [connectionLost, 68, 68, 2],
            ['Ticket does not match the bundle.', 0, 68, 1],
            ['Error Domain=NSURLErrorDomain Code=-10050', 0, 68, 1],
        ]) {
            fs.writeFileSync(path.join(root, 'attempts'), '');
            const result = spawnSync('bash', ['-c', stubs + script], {
                cwd: root,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    STAPLER_ERROR: error,
                    STAPLER_RETRY_STATUS: String(retryStatus),
                },
            });
            assert.equal(result.status, expectedStatus, result.stderr);
            assert.match(result.stdout, /codesign --verify\ngatekeeper/);
            assert.equal(
                fs.readFileSync(path.join(root, 'attempts'), 'utf8'),
                'attempt\n'.repeat(attempts)
            );
            assert.equal(result.stdout.includes('wait 5'), attempts === 2);
            assert.equal(
                result.stdout.includes('::group::Extended attributes'),
                expectedStatus !== 0
            );
        }
    }
);

test(
    'PR merge scope selects packaging inputs and preserves website validation',
    posixOnly,
    (t) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-pr-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const repo = path.join(root, 'repo');
        fs.mkdirSync(path.join(repo, 'apps', 'website'), { recursive: true });
        fs.mkdirSync(path.join(repo, 'tools', 'packaging'), {
            recursive: true,
        });
        fs.copyFileSync(
            new URL('./pr-build-scope.mjs', import.meta.url),
            path.join(repo, 'tools/packaging/pr-build-scope.mjs')
        );

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

        function check(expected, packaging = !expected, e2e = !expected) {
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
                `check-website=${expected}\npackaging=${packaging}\n`
            );
            const ci = parse(
                fs.readFileSync(
                    new URL('../../.github/workflows/ci.yml', import.meta.url),
                    'utf8'
                )
            );
            const e2eScope = ci.jobs['fast-gates'].steps.find(
                ({ id }) => id === 'e2e'
            );
            assert.ok(e2eScope, 'PR E2E needs the original path filter');
            fs.writeFileSync(output, '');
            const e2eResult = spawnSync('bash', ['-c', e2eScope.run], {
                cwd: repo,
                encoding: 'utf8',
                env: { ...env, GITHUB_OUTPUT: output },
            });
            assert.equal(e2eResult.status, 0, e2eResult.stderr);
            assert.equal(fs.readFileSync(output, 'utf8'), `run=${e2e}\n`);
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

        for (const [file, packaging] of [
            ['apps/web/src/app/example.ts', false],
            ['libs/portal/example/src/example.ts', false],
            ['apps/web-backend/src/example.ts', false],
            ['apps/tv/src/example.ts', false],
            ['apps/web-e2e/src/example.e2e.ts', false],
            ['apps/electron-backend-e2e/src/example.e2e.ts', false],
            ['libs/portal/webpack.config.cjs', true],
            ['docs/example.md', false],
            ['apps/electron-backend/src/example.ts', true],
            ['apps/electron-backend/native/example.cc', true],
            ['libs/services/src/lib/example-electron.ts', true],
            ['libs/shared/database/src/example.ts', true],
            ['tools/packaging/example.mjs', true],
            ['tools/embedded-mpv/example.mjs', true],
            ['tools/build/example.mjs', true],
            ['tools/release/nightly-version.mjs', true],
            ['tools/testing/launch-packaged-electron.mjs', true],
            ['patches/example.patch', true],
            ['package.json', true],
            ['pnpm-workspace.yaml', true],
            ['.nvmrc', true],
            ['apps/web/project.json', true],
            ['libs/portal/tsconfig.lib.json', true],
            ['.github/workflows/build-and-make.yaml', true],
            ['unknown-input', true],
            ['libs/portal/unusual\nname.ts', true],
        ]) {
            fs.mkdirSync(path.dirname(path.join(repo, file)), {
                recursive: true,
            });
            fs.writeFileSync(path.join(repo, file), 'fixture');
            git('add', '.');
            git('commit', '-m', 'change fixture');
            check(false, packaging, !file.startsWith('docs/'));
        }
        git(
            'mv',
            'apps/electron-backend/src/example.ts',
            'apps/web/src/moved.ts'
        );
        git('commit', '-m', 'move out of Electron');
        check(false, true);
        fs.writeFileSync(
            path.join(repo, 'apps/website/page.astro'),
            'mixed site'
        );
        fs.writeFileSync(
            path.join(repo, 'apps/web/src/app/example.ts'),
            'mixed renderer'
        );
        git('commit', '-am', 'mixed website and renderer');
        check(true, false, true);
        git('rm', 'apps/website/page.astro');
        fs.writeFileSync(
            path.join(repo, 'docs/example.md'),
            'mixed documentation'
        );
        git('commit', '-am', 'mixed website deletion and documentation');
        check(true, false, false);
        git('commit', '--allow-empty', '-m', 'empty fixture');
        check(false, true, false);

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
                /needs\.appstream-website\.result == 'success'\s*&&\s*needs\.appstream-website\.outputs\.packaging == 'true'/
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

test(
    'fast CI checks gate expensive PR jobs without cancelling draft publication',
    posixOnly,
    () => {
        const readWorkflow = (name) =>
            parse(
                fs.readFileSync(
                    new URL(`../../.github/workflows/${name}`, import.meta.url),
                    'utf8'
                )
            );
        const ci = readWorkflow('ci.yml');
        const e2e = readWorkflow('e2e-tests.yaml');
        const docker = readWorkflow('docker.yml');
        const codeql = readWorkflow('codeql-analysis.yml');
        const gate = ci.jobs['fast-gates'];
        assert.ok(gate, 'CI needs a consolidated fast-gates job');
        assert.equal(
            ci.jobs.preflight,
            undefined,
            'CI should not queue a separate fan-in preflight runner'
        );
        assert.ok(
            gate.steps.some(({ name }) => name === 'Run actionlint'),
            'fast-gates runs actionlint'
        );
        for (const stepName of [
            'Validate release note format',
            'Require a release note for user-visible changes',
            'Preserve PR E2E path exclusions',
        ]) {
            const step = gate.steps.find(({ name }) => name === stepName);
            assert.ok(step, stepName);
            assert.equal(step.if, "github.event_name == 'pull_request'");
        }
        assert.ok(
            gate.steps.some(({ id }) => id === 'scope'),
            'fast-gates computes performance journey scope'
        );

        for (const id of [
            'unit-and-typecheck',
            'initial-bytes-ratchet',
            'performance-journeys',
            'pr-e2e',
        ]) {
            assert.deepEqual(ci.jobs[id].needs, ['fast-gates', 'lint'], id);
            assert.match(ci.jobs[id].if, /!cancelled\(\)/);
            assert.match(
                ci.jobs[id].if,
                /needs\.fast-gates\.result == 'success'/
            );
            assert.match(ci.jobs[id].if, /needs\.lint\.result == 'success'/);
        }
        assert.doesNotMatch(
            ci.jobs['pr-e2e'].if,
            /initial-bytes-ratchet/,
            'PR E2E starts after fast gates and lint without waiting on initial-bytes-ratchet'
        );
        assert.match(
            ci.jobs['pr-e2e'].if,
            /needs\.fast-gates\.outputs\.e2e == 'true'/
        );
        assert.match(
            ci.jobs['performance-journeys'].if,
            /needs\.fast-gates\.outputs\.run == 'true'/
        );

        const unitSteps = ci.jobs['unit-and-typecheck'].steps;
        const scopeIndex = unitSteps.findIndex(({ id }) => id === 'scope');
        const chromiumIndex = unitSteps.findIndex(
            ({ name }) => name === 'Install Chromium for IndexedDB unit contracts'
        );
        assert.ok(scopeIndex >= 0 && chromiumIndex > scopeIndex);
        assert.equal(
            unitSteps[chromiumIndex].if,
            "steps.scope.outputs.run == 'true'"
        );

        const dockerSteps = docker.jobs.build.steps;
        const qemuStep = dockerSteps.find(
            ({ name }) => name === 'Set up QEMU'
        );
        assert.equal(qemuStep.if, "steps.docker-meta.outputs.publish == 'true'");
        const dockerBuildStep = dockerSteps.find(
            ({ name }) => name === 'Build Docker image'
        );
        assert.match(
            dockerBuildStep.with['cache-to'],
            /steps\.docker-meta\.outputs\.publish == 'true'/
        );
        assert.equal(dockerBuildStep.with['cache-from'], 'type=gha');

        for (const event of ['push', 'pull_request']) {
            assert.ok(
                codeql.on[event]['paths-ignore'].includes('**/*.md'),
                `codeql ${event} ignores docs`
            );
            assert.ok(
                codeql.on[event]['paths-ignore'].includes(
                    'apps/web/src/assets/i18n/**'
                ),
                `codeql ${event} ignores locale json`
            );
        }

        for (const id of [
            'linux-embedded-mpv-runtime',
            'build-cross-platform',
            'build-linux',
        ]) {
            assert.match(
                buildWorkflowConfig.jobs[id].concurrency.group,
                /github\.run_id/,
                `${id} non-PR builds use github.run_id so rapid master pushes do not evict queued runs`
            );
        }
        assert.match(
            buildWorkflowConfig.jobs['create-release'].concurrency.group,
            /github\.ref/,
            'create-release stays serialized per ref'
        );

        assert.ok(
            ci.jobs.lint.steps.some(
                ({ run }) => run === 'pnpm run typecheck:ci'
            )
        );
        assert.ok(
            !ci.jobs['unit-and-typecheck'].steps.some(
                ({ run }) => run === 'pnpm run typecheck:ci'
            )
        );
        assert.ok('workflow_call' in e2e.on);
        assert.ok(
            !('pull_request' in e2e.on),
            'PR E2E must run only through CI'
        );
        assert.ok('push' in e2e.on && 'workflow_dispatch' in e2e.on);
        assert.equal(
            ci.jobs['pr-e2e'].uses,
            './.github/workflows/e2e-tests.yaml'
        );
        assert.notEqual(e2e.concurrency.group, ci.concurrency.group);
        assert.ok('pull_request' in buildWorkflowConfig.on);
        assert.equal(buildWorkflowConfig.concurrency, undefined);
        const steps = buildWorkflowConfig.jobs['appstream-website'].steps;
        for (const command of [
            'pnpm run typecheck:ci',
            'pnpm nx affected --target=lint',
        ]) {
            const step = steps.find(({ run }) => run?.startsWith(command));
            assert.ok(step, command);
            assert.equal(step.if, "steps.scope.outputs.packaging == 'true'");
        }
    }
);

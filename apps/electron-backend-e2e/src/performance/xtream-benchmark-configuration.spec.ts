import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { workspaceRoot } from '../electron-test-fixtures';
import { createXtreamIterationDefinitions } from './xtream-benchmark-contract';
import { BUILD_IDENTITY } from './xtream-benchmark-report.fixtures';
import {
    type XtreamBenchmarkConfiguration,
    assertXtreamBenchmarkBuildUnchanged,
    assertXtreamBenchmarkOutputPathHasNoSymlinks,
    createXtreamBenchmarkManifest,
    resolveXtreamBenchmarkCdpPort,
    resolveXtreamBenchmarkConfiguration,
    resolveXtreamBenchmarkOutputLayout,
    XTREAM_BENCHMARK_MOCK_ORIGIN,
} from './xtream-benchmark-configuration';
import { XTREAM_MEMORY_ACCOUNTING } from './xtream-summary-contract';

const SOURCE = Object.freeze({
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    gitDiffSha256:
        'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    gitDirty: false,
});
const FIXTURE = Object.freeze({
    bytes: 12_345,
    catalogSha256:
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    counts: {
        categories: { live: 60, vod: 20, series: 20, total: 100 },
        items: {
            live: 60_000,
            vod: 20_000,
            series: 20_000,
            total: 100_000,
        },
    },
    epoch: 1,
    scenario: 'performance-100k',
    seed: 91_001,
} as const);
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
});

describe('Xtream benchmark output configuration', () => {
    it('accepts only a fresh timestamp directory directly below dist/performance', async () => {
        const repositoryRoot = await createRepositoryRoot();
        const performanceRoot = join(repositoryRoot, 'dist', 'performance');
        const outputRoot = join(
            performanceRoot,
            '20260728T123456Z-xtream-smoke'
        );

        assert.deepEqual(
            resolveXtreamBenchmarkOutputLayout(
                repositoryRoot,
                outputRoot,
                'baseline'
            ),
            {
                outputDirectory: join(outputRoot, 'baseline'),
                outputRoot,
                performanceRoot,
            }
        );

        for (const requestedRoot of [
            'dist/performance/20260728T123456Z',
            performanceRoot,
            join(performanceRoot, 'nested', '20260728T123456Z'),
            join(performanceRoot, 'not-a-timestamp'),
            join(repositoryRoot, 'outside', '20260728T123456Z'),
        ]) {
            assert.throws(
                () =>
                    resolveXtreamBenchmarkOutputLayout(
                        repositoryRoot,
                        requestedRoot,
                        'baseline'
                    ),
                /absolute fresh timestamp path below dist\/performance/
            );
        }
        assert.throws(
            () =>
                resolveXtreamBenchmarkOutputLayout(
                    repositoryRoot,
                    outputRoot,
                    '../after'
                ),
            /safe Xtream variant/
        );
    });

    it('rejects every existing symbolic-link component', async () => {
        const repositoryRoot = await createRepositoryRoot();
        const realDist = join(repositoryRoot, 'real-dist');
        await mkdir(realDist);
        await import('node:fs/promises').then(({ symlink }) =>
            symlink(realDist, join(repositoryRoot, 'dist'))
        );

        await assert.rejects(
            () =>
                assertXtreamBenchmarkOutputPathHasNoSymlinks(
                    repositoryRoot,
                    join(
                        repositoryRoot,
                        'dist',
                        'performance',
                        '20260728T123456Z'
                    )
                ),
            /contains a symbolic link/
        );
    });
});

describe('Xtream benchmark mode configuration', () => {
    it('pins formal CDP to 9222 and bounds smoke-only alternate ports', () => {
        assert.equal(resolveXtreamBenchmarkCdpPort('formal', undefined), 9222);
        assert.equal(resolveXtreamBenchmarkCdpPort('smoke', '9322'), 9322);
        assert.throws(
            () => resolveXtreamBenchmarkCdpPort('formal', '9322'),
            /Formal Xtream performance runs require CDP port 9222/
        );
        for (const requested of ['1023', '65536', '9322.5', '0x246a']) {
            assert.throws(
                () => resolveXtreamBenchmarkCdpPort('smoke', requested),
                /IPTVNATOR_PERF_CDP_PORT is invalid/
            );
        }
    });

    it('creates output only after preflight and uses exclusive child mkdir calls', async () => {
        const repositoryRoot = await createRepositoryRoot();
        const performanceRoot = join(repositoryRoot, 'dist', 'performance');
        await mkdir(performanceRoot, { recursive: true });
        const outputRoot = join(
            performanceRoot,
            '20260728T123456Z-xtream-smoke'
        );
        const calls: string[] = [];
        const configuration = await resolveXtreamBenchmarkConfiguration({
            dependencies: {
                assertCapacity: async () => {
                    calls.push('preflight');
                    return {
                        availableBytes: BigInt(3 * 1_024 ** 3),
                        checkedPath: performanceRoot,
                        minimumBytes: BigInt(2 * 1_024 ** 3),
                    };
                },
                captureBuildIdentity: async () => BUILD_IDENTITY,
                mkdir: async (path, options) => {
                    calls.push(
                        `mkdir:${path}:${String(
                            options?.recursive ?? false
                        )}:${String(options?.mode ?? 'default')}`
                    );
                    await mkdir(path, options);
                },
                readElectronVersion: async () => '41.0.0',
                readGitSourceState: () => SOURCE,
            },
            environment: {
                IPTVNATOR_PERF_CDP_PORT: '9322',
                IPTVNATOR_PERF_OUTPUT_DIR: outputRoot,
                IPTVNATOR_PERF_SMOKE: '1',
                IPTVNATOR_PERF_VARIANT: 'smoke',
                IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'a'.repeat(64),
            },
            workspaceRoot: repositoryRoot,
        });

        assert.equal(calls[0], 'preflight');
        assert.deepEqual(calls.slice(1), [
            `mkdir:${performanceRoot}:true:${0o700}`,
            `mkdir:${outputRoot}:false:${0o700}`,
            `mkdir:${join(outputRoot, 'smoke')}:false:${0o700}`,
        ]);
        assert.equal((await stat(outputRoot)).mode & 0o777, 0o700);
        assert.equal(
            (await stat(join(outputRoot, 'smoke'))).mode & 0o777,
            0o700
        );
        assert.equal(configuration.mode, 'smoke');
        assert.equal(configuration.measuredRuns, 1);
        assert.equal(configuration.outputDirectory, join(outputRoot, 'smoke'));
        assert.equal(configuration.mockOrigin, XTREAM_BENCHMARK_MOCK_ORIGIN);
        assert.equal(
            createXtreamIterationDefinitions(configuration.smoke)
                .filter((entry) => entry.kind === 'measured')
                .every((entry) => !entry.eligibleForComparison),
            true
        );
    });

    it('fails formal resolution before preflight when tracked source is dirty', async () => {
        const repositoryRoot = await createRepositoryRoot();
        let preflightCalled = false;

        await assert.rejects(
            () =>
                resolveXtreamBenchmarkConfiguration({
                    dependencies: {
                        assertCapacity: async () => {
                            preflightCalled = true;
                            throw new Error('unexpected preflight');
                        },
                        captureBuildIdentity: async () => BUILD_IDENTITY,
                        readElectronVersion: async () => '41.0.0',
                        readGitSourceState: () => ({
                            ...SOURCE,
                            gitDirty: true,
                        }),
                    },
                    environment: {
                        IPTVNATOR_PERF_OUTPUT_DIR: join(
                            repositoryRoot,
                            'dist',
                            'performance',
                            '20260728T123456Z-xtream'
                        ),
                        IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'b'.repeat(64),
                    },
                    workspaceRoot: repositoryRoot,
                }),
            /Formal Xtream performance runs require a clean Git worktree/
        );
        assert.equal(preflightCalled, false);
    });
});

describe('Xtream benchmark manifest provenance', () => {
    it('creates an exact manifest from the canonical prepared mock fixture only', () => {
        const configuration = configurationFixture();
        const manifest = createXtreamBenchmarkManifest(configuration, FIXTURE);

        assert.equal(manifest.fixture.categories, 100);
        assert.equal(manifest.fixture.items, 100_000);
        assert.deepEqual(manifest.build, BUILD_IDENTITY);
        assert.deepEqual(manifest.source, SOURCE);
        assert.deepEqual(manifest.memoryAccounting, XTREAM_MEMORY_ACCOUNTING);
        assert.equal(
            JSON.stringify(manifest).includes(configuration.controlToken),
            false
        );
        assert.throws(
            () =>
                createXtreamBenchmarkManifest(configuration, {
                    ...FIXTURE,
                    scenario: 'large',
                }),
            /invalid Xtream performance fixture/
        );
    });

    it('recaptures and requires byte-identical build identity at suite end', async () => {
        const configuration = configurationFixture();
        await assert.doesNotReject(() =>
            assertXtreamBenchmarkBuildUnchanged(configuration, async () =>
                structuredClone(BUILD_IDENTITY)
            )
        );
        await assert.rejects(
            () =>
                assertXtreamBenchmarkBuildUnchanged(
                    configuration,
                    async () => ({
                        ...BUILD_IDENTITY,
                        renderer: {
                            ...BUILD_IDENTITY.renderer,
                            aggregateSha256: 'f'.repeat(64),
                        },
                    })
                ),
            /Xtream performance build changed during the suite/
        );
    });
});

describe('Xtream Playwright and Nx plumbing', () => {
    it('uses one isolated control-enabled mock and one no-retry 30-minute test', async () => {
        const configPath = join(
            workspaceRoot,
            'apps/electron-backend-e2e/playwright.xtream-performance.config.ts'
        );
        const source = await readFile(configPath, 'utf8');

        assert.match(source, /randomBytes\(32\)/);
        assert.match(
            source,
            /process\.env\['IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN'\]\s*\?\?/
        );
        assert.match(source, /http:\/\/127\.0\.0\.1:3221\/health/);
        assert.match(source, /reuseExistingServer:\s*false/);
        assert.match(source, /IPTVNATOR_XTREAM_MOCK_CONTROL:\s*'1'/);
        assert.match(
            source,
            /IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN:\s*controlToken/
        );
        assert.match(source, /HOST:\s*'127\.0\.0\.1'/);
        assert.match(source, /PORT:\s*'3221'/);
        assert.match(source, /retries:\s*0/);
        assert.match(source, /workers:\s*1/);
        assert.match(source, /timeout:\s*30\s*\*\s*60\s*\*\s*1_000/);
    });

    it('pins the Nx target and keeps the entrypoint to one orchestrator call', async () => {
        const [project, entrypoint] = await Promise.all([
            readFile(
                join(workspaceRoot, 'apps/electron-backend-e2e/project.json'),
                'utf8'
            ).then(
                (value) =>
                    JSON.parse(value) as {
                        targets: Record<string, Record<string, unknown>>;
                    }
            ),
            readFile(
                join(
                    workspaceRoot,
                    'apps/electron-backend-e2e/src/xtream.performance.ts'
                ),
                'utf8'
            ),
        ]);
        const target = project.targets['benchmark-xtream'];

        assert.deepEqual(target?.['dependsOn'], [
            'electron-backend:build-performance',
        ]);
        assert.equal(target?.['cache'], false);
        assert.equal(target?.['parallelism'], false);
        assert.equal(
            (target?.['options'] as Record<string, unknown>)?.['command'],
            'pnpm exec playwright test --config=playwright.xtream-performance.config.ts src/xtream.performance.ts'
        );
        assert.equal(
            (entrypoint.match(/runXtreamBenchmark\(\)/g) ?? []).length,
            1
        );
        assert.equal((entrypoint.match(/\btest\(/g) ?? []).length, 1);
    });
});

async function createRepositoryRoot(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'iptvnator-xtream-config-'));
    temporaryDirectories.push(directory);
    return directory;
}

function configurationFixture(): XtreamBenchmarkConfiguration {
    return {
        build: BUILD_IDENTITY,
        cdpPort: 9222,
        controlToken: 'c'.repeat(64),
        electronVersion: '41.0.0',
        measuredRuns: 5,
        mockOrigin: XTREAM_BENCHMARK_MOCK_ORIGIN,
        mode: 'formal' as const,
        outputDirectory: resolve('/tmp/xtream/baseline'),
        outputRoot: resolve('/tmp/xtream'),
        runtime: {
            arch: 'arm64',
            electronVersion: '41.0.0',
            harnessNodeVersion: '22.0.0',
            platform: 'darwin',
        },
        smoke: false,
        source: SOURCE,
        variant: 'baseline',
        workspaceRoot: resolve('/repository'),
    };
}

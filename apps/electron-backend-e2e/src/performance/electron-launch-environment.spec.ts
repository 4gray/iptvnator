import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
    buildElectronLaunchEnvironment,
    ELECTRON_RUNTIME_ENVIRONMENT_KEYS,
} from '../electron-test-fixtures';
import { assertXtreamBenchmarkEnvironmentIsolated } from './xtream-benchmark-iteration-support';

describe('Electron launch environment isolation', () => {
    it('makes post-spawn fixture preparation exception-safe', () => {
        const fixture = readFileSync(
            resolve(process.cwd(), 'src/electron-test-fixtures.ts'),
            'utf8'
        );
        const launch = fixture.indexOf(
            'const electronApp = await electron.launch'
        );
        const guardedPreparation = fixture.indexOf(
            'return prepareElectronApplication',
            launch
        );
        const strictDisposal = fixture.indexOf(
            'closeElectronApplicationAndConfirmExit',
            guardedPreparation
        );
        const mainWindow = fixture.indexOf(
            'const mainWindow = await findMainWindow',
            guardedPreparation
        );

        assert.ok(launch >= 0);
        assert.ok(guardedPreparation > launch);
        assert.ok(strictDisposal > guardedPreparation);
        assert.ok(mainWindow > strictDisposal);
    });

    it('inherits only portable runtime keys for a profiled benchmark child', () => {
        const environment = buildElectronLaunchEnvironment(
            '/tmp/iptvnator-performance',
            {
                environmentInheritance: 'runtime-only',
                env: {
                    IPTVNATOR_PERF_CAPTURE: '1',
                },
            },
            {
                AWS_SECRET_ACCESS_KEY: 'aws-secret',
                ELECTRON_RUN_AS_NODE: '1',
                GITHUB_TOKEN: 'github-secret',
                HTTPS_PROXY: 'https://user:password@proxy.invalid',
                IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS: '0',
                IPTVNATOR_REAL_PROVIDER_URL: 'https://provider.invalid',
                IPTVNATOR_XTREAM_MOCK_CONTROL: '1',
                IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'secret-token',
                NODE_OPTIONS: '--require credential-dumper.js',
                PATH: '/usr/bin',
                REAL_PROVIDER_PASSWORD: 'provider-password',
                REAL_PROVIDER_URL: 'https://provider.invalid',
                TMPDIR: '/tmp/runtime',
            }
        );

        assert.equal(environment['IPTVNATOR_PERF_CAPTURE'], '1');
        assert.equal(environment['IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS'], '1');
        assert.equal(environment['PATH'], '/usr/bin');
        assert.equal(environment['TMPDIR'], '/tmp/runtime');
        for (const key of [
            'AWS_SECRET_ACCESS_KEY',
            'ELECTRON_RUN_AS_NODE',
            'GITHUB_TOKEN',
            'HTTPS_PROXY',
            'IPTVNATOR_REAL_PROVIDER_URL',
            'IPTVNATOR_XTREAM_MOCK_CONTROL',
            'IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN',
            'NODE_OPTIONS',
            'REAL_PROVIDER_PASSWORD',
            'REAL_PROVIDER_URL',
        ]) {
            assert.equal(environment[key], undefined, key);
        }
    });

    it('drops undefined overrides instead of serializing them into the child', () => {
        const environment = buildElectronLaunchEnvironment(
            '/tmp/iptvnator-performance',
            { env: { OPTIONAL_DEBUG_FLAG: undefined } },
            { OPTIONAL_DEBUG_FLAG: 'inherited' }
        );

        assert.equal(environment['OPTIONAL_DEBUG_FLAG'], undefined);
    });

    it('checks the effective Electron main environment, not only launch input', async () => {
        const allowed = [
            ...ELECTRON_RUNTIME_ENVIRONMENT_KEYS,
            'ELECTRON_IS_DEV',
            'IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS',
            'IPTVNATOR_DB_WORKER_BATCH_DELAY_MS',
            'IPTVNATOR_E2E_DATA_DIR',
            'IPTVNATOR_PERF_CAPTURE',
            'IPTVNATOR_PERF_WORKER_PROFILING',
            'IPTVNATOR_TRACE_RENDERER_CONSOLE',
            'NODE_ENV',
        ];

        await assert.doesNotReject(
            assertXtreamBenchmarkEnvironmentIsolated(fakeApp(allowed))
        );
        for (const leaked of [
            'GITHUB_TOKEN',
            'HTTPS_PROXY',
            'NODE_OPTIONS',
            'REAL_PROVIDER_URL',
        ]) {
            await assert.rejects(
                assertXtreamBenchmarkEnvironmentIsolated(
                    fakeApp([...allowed, leaked])
                ),
                /xtream-benchmark-environment-reached-electron/
            );
        }
    });
});

function fakeApp(keys: readonly string[]) {
    return {
        electronApp: {
            evaluate: async () => [...keys],
        },
    } as never;
}

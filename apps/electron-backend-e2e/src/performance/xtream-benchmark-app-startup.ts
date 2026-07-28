import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    closeElectronAppAndConfirmExit,
    launchElectronApp,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';
import { ElectronApplicationDisposalError } from '../electron-process-lifecycle';
import type { XtreamBenchmarkConfiguration } from './xtream-benchmark-configuration';
import {
    installMainCapture,
    type MainCaptureStartOptions,
} from './m3u-refresh-main-capture';
import {
    assertRendererCdpTarget,
    assertTcpPortAvailable,
    resolveRendererWindowIdentity,
} from './m3u-import-benchmark-support';
import {
    assertXtreamBenchmarkEnvironmentIsolated,
    prearmXtreamDatabaseWorker,
} from './xtream-benchmark-iteration-support';
import { disableGenericElectronFixtureProbes } from './xtream-benchmark-runtime';
import {
    captureXtreamLaunchIdentity,
    type XtreamLaunchIdentity,
} from './xtream-process-evidence';
import {
    classifyXtreamStartupFailure,
    runXtreamStartupWithRetry,
} from './xtream-startup-retry';
import type { XtreamStartupRetryReason } from './xtream-summary-contract';

interface XtreamAppResource {
    readonly app: LaunchedElectronApp;
    readonly dataDirectory: string;
}

interface PreparedXtreamApp {
    readonly launch: XtreamLaunchIdentity;
    readonly rendererWindowIdentity: MainCaptureStartOptions['rendererWindowIdentity'];
}

export interface LaunchedXtreamBenchmarkApp
    extends XtreamAppResource, PreparedXtreamApp {
    readonly startupEvidence: {
        readonly attemptCount: number;
        readonly retryReasons: readonly XtreamStartupRetryReason[];
        readonly status: 'ready';
    };
}

export interface LaunchXtreamBenchmarkAppOptions {
    readonly configuration: XtreamBenchmarkConfiguration;
    readonly seenElectronPids: Set<number>;
}

async function disposeXtreamAppResource(
    resource: XtreamAppResource
): Promise<void> {
    await closeElectronAppAndConfirmExit(resource.app);
    await removeXtreamDataDirectory(resource.dataDirectory);
}

async function createXtreamAppResource(
    configuration: XtreamBenchmarkConfiguration
): Promise<XtreamAppResource> {
    await assertTcpPortAvailable(configuration.cdpPort);
    const dataDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-xtream-performance-')
    );
    try {
        const app = await launchElectronApp(dataDirectory, {
            args: [
                '--js-flags=--expose-gc',
                '--remote-debugging-address=127.0.0.1',
                `--remote-debugging-port=${configuration.cdpPort}`,
                `--user-data-dir=${join(dataDirectory, 'user-data')}`,
            ],
            environmentInheritance: 'runtime-only',
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: '0',
                IPTVNATOR_PERF_CAPTURE: '1',
                IPTVNATOR_PERF_WORKER_PROFILING: '1',
                IPTVNATOR_TRACE_RENDERER_CONSOLE: '0',
            },
            omitEnvKeys: [
                'IPTVNATOR_XTREAM_MOCK_CONTROL',
                'IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN',
            ],
        });
        return { app, dataDirectory };
    } catch (failure) {
        if (failure instanceof ElectronApplicationDisposalError) {
            throw failure;
        }
        try {
            await removeXtreamDataDirectory(dataDirectory);
        } catch (cleanupFailure) {
            throw new AggregateError(
                [failure, cleanupFailure],
                'Xtream app launch and profile cleanup both failed',
                { cause: failure }
            );
        }
        throw failure;
    }
}

function removeXtreamDataDirectory(dataDirectory: string): Promise<void> {
    return rm(dataDirectory, { force: true, recursive: true });
}

async function prepareXtreamAppResource(
    resource: XtreamAppResource,
    options: LaunchXtreamBenchmarkAppOptions
): Promise<PreparedXtreamApp> {
    const { app } = resource;
    const { configuration } = options;
    app.mainWindow.setDefaultTimeout(10 * 60 * 1_000);
    await assertXtreamBenchmarkEnvironmentIsolated(app);
    await disableGenericElectronFixtureProbes(app.mainWindow);
    await assertRendererCdpTarget(app.mainWindow, configuration.cdpPort);
    await installMainCapture(app.electronApp);
    await prearmXtreamDatabaseWorker(app);
    const launch = await captureXtreamLaunchIdentity(
        app.electronApp,
        app.electronApp.process().pid,
        options.seenElectronPids
    );
    const rendererWindowIdentity = await resolveRendererWindowIdentity(app);
    return { launch, rendererWindowIdentity };
}

export async function launchXtreamBenchmarkApp(
    options: LaunchXtreamBenchmarkAppOptions
): Promise<LaunchedXtreamBenchmarkApp> {
    const started = await runXtreamStartupWithRetry({
        classifyFailure: classifyXtreamStartupFailure,
        create: () => createXtreamAppResource(options.configuration),
        dispose: disposeXtreamAppResource,
        maxAttempts: 2,
        prepare: (resource) => prepareXtreamAppResource(resource, options),
    });
    return Object.freeze({
        ...started.resource,
        ...started.prepared,
        startupEvidence: Object.freeze({
            attemptCount: started.attemptCount,
            retryReasons: started.retryReasons,
            status: 'ready' as const,
        }),
    });
}

export async function disposeXtreamBenchmarkApp(
    app: LaunchedElectronApp,
    dataDirectory: string
): Promise<void> {
    await disposeXtreamAppResource({ app, dataDirectory });
}

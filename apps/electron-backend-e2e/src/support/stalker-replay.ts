import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { resolve } from 'node:path';

type ReplayLedger = {
    mismatchCounts: Record<string, number>;
    operationCounts: Record<string, number>;
    terminalState: string | null;
};

type ReplayFinalizeIssue = {
    code: string;
    operation?: string;
};

export type StalkerReplayFinalization =
    | {
          ledger: ReplayLedger;
          ok: true;
      }
    | {
          issues: ReplayFinalizeIssue[];
          ledger: ReplayLedger;
          ok: false;
      };

export type StalkerReplayRun = {
    entryUrl: string;
    inputs: Readonly<Record<string, string>>;
    origins: Readonly<Record<string, string>>;
};

export type StalkerReplayResult<Result> = {
    finalization: StalkerReplayFinalization;
    result: Result;
};

type ReplayCreateResponse = {
    entryUrl: string;
    inputs: Record<string, string>;
    origins: Record<string, string>;
    runId: string;
};

type ReplayDisposeResponse = {
    disposed: true;
};

type ReplayControlAction = 'create' | 'dispose' | 'finalize';

type ReplayControlProcess = {
    capability: string;
    capabilityHeader: string;
    close: () => Promise<void>;
    url: string;
};

type ReplayControlProcessReady = Omit<ReplayControlProcess, 'close'>;

const workspaceRoot = resolve(__dirname, '../../../..');
const controlStartupTimeoutMs = 15_000;
const controlShutdownTimeoutMs = 5_000;
const controlOutputLimit = 64 * 1024;
const controlReadyPrefix = 'IPTVNATOR_STALKER_REPLAY_CONTROL=';

/**
 * Runs one repository-allowlisted replay behind an authenticated loopback
 * control plane. The capability and run id never cross into the Electron app.
 */
export async function withStalkerReplayRun<Result>(
    fixtureId: string,
    use: (run: StalkerReplayRun) => Promise<Result>
): Promise<StalkerReplayResult<Result>> {
    const control = await startReplayControlProcess();
    let run: ReplayCreateResponse | undefined;
    let callbackResult: Result | undefined;
    let callbackCompleted = false;
    let callbackError: unknown;
    let finalization: StalkerReplayFinalization | undefined;
    let finalizationError: unknown;

    try {
        run = await controlRequest<ReplayCreateResponse>(
            control.url,
            control.capability,
            control.capabilityHeader,
            'create',
            { fixtureId }
        );

        try {
            callbackResult = await use({
                entryUrl: run.entryUrl,
                inputs: Object.freeze({ ...run.inputs }),
                origins: Object.freeze({ ...run.origins }),
            });
            callbackCompleted = true;
        } catch (error) {
            callbackError = error;
        } finally {
            try {
                finalization =
                    await controlRequest<StalkerReplayFinalization>(
                        control.url,
                        control.capability,
                        control.capabilityHeader,
                        'finalize',
                        { runId: run.runId }
                    );
            } catch (error) {
                finalizationError = error;
            }

            await controlRequest<ReplayDisposeResponse>(
                control.url,
                control.capability,
                control.capabilityHeader,
                'dispose',
                { runId: run.runId }
            );
        }
    } finally {
        await control.close();
    }

    if (callbackError !== undefined) {
        throw callbackError;
    }
    if (finalizationError !== undefined) {
        throw finalizationError;
    }
    if (!callbackCompleted || finalization === undefined) {
        throw new Error('stalker-replay-incomplete');
    }

    return {
        finalization,
        result: callbackResult as Result,
    };
}

async function controlRequest<Response>(
    controlUrl: string,
    capability: string,
    capabilityHeader: string,
    action: ReplayControlAction,
    body: Readonly<Record<string, string>>
): Promise<Response> {
    const response = await fetch(`${controlUrl}/v1/replay/${action}`, {
        body: JSON.stringify(body),
        headers: {
            'content-type': 'application/json',
            [capabilityHeader]: capability,
        },
        method: 'POST',
    });
    const value: unknown = await response.json();

    if (!response.ok) {
        throw new Error(readControlError(value));
    }

    return value as Response;
}

async function startReplayControlProcess(): Promise<ReplayControlProcess> {
    const child = spawn(
        'pnpm',
        ['exec', 'tsx', '--eval', replayControlScript()],
        {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
                NO_COLOR: '1',
                TSX_TSCONFIG_PATH: resolve(
                    workspaceRoot,
                    'tsconfig.base.json'
                ),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );

    const ready = await waitForControlReady(child);
    child.stdout.resume();
    child.stderr.resume();

    return {
        ...ready,
        close: () => closeControlProcess(child),
    };
}

function replayControlScript(): string {
    return [
        '(async () => {',
        "const replayModule = await import('./apps/stalker-mock-server/src/app/replay/replay-control-plane.ts');",
        'const replay = replayModule.default ?? replayModule;',
        "const path = await import('node:path');",
        'const capability = replay.createReplayControlPlaneCapability();',
        "const repository = new replay.RepositoryReplayFixtureRepository(path.resolve('apps/stalker-mock-server/fixtures/replay'));",
        'const control = await replay.startReplayControlPlane({ capability, repository });',
        `process.stdout.write('${controlReadyPrefix}' + JSON.stringify({ capability, capabilityHeader: replay.REPLAY_CONTROL_CAPABILITY_HEADER, url: control.url }) + String.fromCharCode(10));`,
        'let closing = false;',
        'const close = async () => { if (closing) return; closing = true; await control.close(); process.exit(0); };',
        "process.stdin.once('end', () => void close());",
        "process.once('SIGTERM', () => void close());",
        'process.stdin.resume();',
        "})().catch(() => { process.stderr.write('stalker-replay-control-start-failed'); process.exit(1); });",
    ].join('');
}

function waitForControlReady(
    child: ChildProcessWithoutNullStreams
): Promise<ReplayControlProcessReady> {
    return new Promise((resolveReady, rejectReady) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (
            outcome:
                | { kind: 'ready'; value: ReplayControlProcessReady }
                | { kind: 'error'; error: Error }
        ) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            child.stdout.off('data', onStdout);
            child.stderr.off('data', onStderr);
            child.off('exit', onExit);
            if (outcome.kind === 'ready') {
                resolveReady(outcome.value);
            } else {
                if (
                    child.exitCode === null &&
                    child.signalCode === null
                ) {
                    child.kill('SIGTERM');
                }
                rejectReady(outcome.error);
            }
        };
        const onStdout = (chunk: Buffer | string) => {
            try {
                stdout = appendBounded(stdout, chunk);
            } catch {
                finish({
                    kind: 'error',
                    error: new Error(
                        'stalker-replay-control-output-too-large'
                    ),
                });
                return;
            }
            const readyLine = stdout
                .split('\n')
                .find((line) => line.startsWith(controlReadyPrefix));
            if (readyLine === undefined) {
                return;
            }
            try {
                finish({
                    kind: 'ready',
                    value: parseControlReady(
                        readyLine.slice(controlReadyPrefix.length)
                    ),
                });
            } catch {
                finish({
                    kind: 'error',
                    error: new Error('stalker-replay-control-invalid-ready'),
                });
            }
        };
        const onStderr = (chunk: Buffer | string) => {
            try {
                stderr = appendBounded(stderr, chunk);
            } catch {
                finish({
                    kind: 'error',
                    error: new Error(
                        'stalker-replay-control-output-too-large'
                    ),
                });
            }
        };
        const onExit = () =>
            finish({
                kind: 'error',
                error: new Error(
                    stderr.includes('stalker-replay-control-start-failed')
                        ? 'stalker-replay-control-start-failed'
                        : 'stalker-replay-control-exited'
                ),
            });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish({
                kind: 'error',
                error: new Error('stalker-replay-control-start-timeout'),
            });
        }, controlStartupTimeoutMs);

        child.stdout.on('data', onStdout);
        child.stderr.on('data', onStderr);
        child.once('exit', onExit);
    });
}

function parseControlReady(value: string): ReplayControlProcessReady {
    const parsed: unknown = JSON.parse(value);
    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !('capability' in parsed) ||
        typeof parsed.capability !== 'string' ||
        !('capabilityHeader' in parsed) ||
        typeof parsed.capabilityHeader !== 'string' ||
        !('url' in parsed) ||
        typeof parsed.url !== 'string'
    ) {
        throw new Error('stalker-replay-control-invalid-ready');
    }

    return {
        capability: parsed.capability,
        capabilityHeader: parsed.capabilityHeader,
        url: parsed.url,
    };
}

async function closeControlProcess(
    child: ChildProcessWithoutNullStreams
): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    const exited = new Promise<void>((resolveExit) => {
        child.once('exit', () => resolveExit());
    });
    child.stdin.end();
    const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise<true>((resolveTimeout) => {
            setTimeout(
                () => resolveTimeout(true),
                controlShutdownTimeoutMs
            ).unref();
        }),
    ]);

    if (timedOut) {
        child.kill('SIGTERM');
        await exited;
    }
}

function appendBounded(current: string, chunk: Buffer | string): string {
    const appended = current + chunk.toString();
    if (Buffer.byteLength(appended) > controlOutputLimit) {
        throw new Error('stalker-replay-control-output-too-large');
    }
    return appended;
}

function readControlError(value: unknown): string {
    if (
        value !== null &&
        typeof value === 'object' &&
        'error' in value &&
        value.error !== null &&
        typeof value.error === 'object' &&
        'code' in value.error &&
        typeof value.error.code === 'string'
    ) {
        return value.error.code;
    }

    return 'stalker-replay-control-failed';
}

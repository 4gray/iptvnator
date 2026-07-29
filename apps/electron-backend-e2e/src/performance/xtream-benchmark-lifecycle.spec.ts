import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
    createXtreamSingleAttemptCapture,
    persistXtreamIterationFailureEvidence,
    persistXtreamIterationFailureEvidenceAndThrow,
    runXtreamFinalTeardown,
} from './xtream-benchmark-lifecycle';

const performanceDirectory = resolve(process.cwd(), 'src/performance');

describe('Xtream benchmark failure lifecycle', () => {
    it('memoizes capture finalization across success and failure paths', async () => {
        let attempts = 0;
        const capture = createXtreamSingleAttemptCapture(async () => {
            attempts += 1;
            return Object.freeze({ capture: 'complete' });
        });

        const [first, second] = await Promise.all([capture(), capture()]);
        const third = await capture();

        assert.equal(attempts, 1);
        assert.strictEqual(first, second);
        assert.strictEqual(second, third);

        let failedAttempts = 0;
        const failedCapture = createXtreamSingleAttemptCapture(async () => {
            failedAttempts += 1;
            throw new Error('fixed-test-failure');
        });
        await assert.rejects(failedCapture, /fixed-test-failure/);
        await assert.rejects(failedCapture, /fixed-test-failure/);
        assert.equal(failedAttempts, 1);
    });

    it('persists all available evidence and only fixed failure metadata', async () => {
        const persisted = new Map<string, unknown>();
        const attempts: string[] = [];

        await persistXtreamIterationFailureEvidence({
            evidence: {
                control: async () => {
                    attempts.push('control');
                    return { epoch: 11 };
                },
                mainCapture: async () => {
                    attempts.push('mainCapture');
                    return { captureGeneration: 3 };
                },
                mainStatus: async () => {
                    attempts.push('mainStatus');
                    return { captureGeneration: 3, pending: 1 };
                },
                rendererCapture: async () => {
                    attempts.push('rendererCapture');
                    throw new Error(
                        'https://performance:performance@example.invalid?token=secret'
                    );
                },
                terminal: async () => {
                    attempts.push('terminal');
                    return { terminalEpochMs: 42 };
                },
            },
            persist: async (filename, value) => {
                persisted.set(filename, value);
            },
            stage: 'terminal-settlement',
        });

        assert.deepEqual(attempts.sort(), [
            'control',
            'mainCapture',
            'mainStatus',
            'rendererCapture',
            'terminal',
        ]);
        assert.deepEqual([...persisted.keys()].sort(), [
            'failure-control-state.json',
            'failure-main-capture.json',
            'failure-main-status.json',
            'failure-terminal-evidence.json',
            'failure.json',
        ]);
        const metadata = persisted.get('failure.json');
        assert.deepEqual(metadata, {
            evidence: {
                control: 'captured',
                mainCapture: 'captured',
                mainStatus: 'captured',
                rendererCapture: 'capture-failed',
                terminal: 'captured',
                trigger: 'not-available',
            },
            reason: 'xtream-benchmark-iteration-failed',
            stage: 'terminal-settlement',
            status: 'failed',
            validForComparison: false,
        });
        const serialized = JSON.stringify([...persisted.values()]);
        assert.doesNotMatch(serialized, /performance:performance|secret/iu);
        assert.doesNotMatch(serialized, /message|stack/iu);
    });

    it('persists fixed failure metadata when capture setup never completed', async () => {
        const persisted = new Map<string, unknown>();

        await persistXtreamIterationFailureEvidence({
            evidence: {},
            persist: async (filename, value) => {
                persisted.set(filename, value);
            },
            stage: 'capture-setup',
        });

        assert.deepEqual([...persisted.keys()], ['failure.json']);
        assert.deepEqual(persisted.get('failure.json'), {
            evidence: {
                control: 'not-available',
                mainCapture: 'not-available',
                mainStatus: 'not-available',
                rendererCapture: 'not-available',
                terminal: 'not-available',
                trigger: 'not-available',
            },
            reason: 'xtream-benchmark-iteration-failed',
            stage: 'capture-setup',
            status: 'failed',
            validForComparison: false,
        });
    });

    it('fails when aggregate failure evidence cannot be persisted', async () => {
        await assert.rejects(
            persistXtreamIterationFailureEvidence({
                evidence: {},
                persist: async (filename) => {
                    if (filename === 'failure.json') {
                        throw new Error('fixed-persistence-failure');
                    }
                },
                stage: 'capture-setup',
            }),
            /fixed-persistence-failure/
        );
    });

    it('rethrows the original iteration failure after evidence persistence succeeds', async () => {
        const originalFailure = new Error('fixed-original-failure');

        await assert.rejects(
            persistXtreamIterationFailureEvidenceAndThrow(originalFailure, {
                evidence: {},
                persist: async () => undefined,
                stage: 'capture-setup',
            }),
            (failure: unknown) => {
                assert.strictEqual(failure, originalFailure);
                return true;
            }
        );
    });

    it('preserves both the original and evidence persistence failures', async () => {
        const originalFailure = new Error('fixed-original-failure');
        const persistenceFailure = new Error('fixed-persistence-failure');

        await assert.rejects(
            persistXtreamIterationFailureEvidenceAndThrow(originalFailure, {
                evidence: {},
                persist: async (filename) => {
                    if (filename === 'failure.json') {
                        throw persistenceFailure;
                    }
                },
                stage: 'capture-setup',
            }),
            (failure: unknown) => {
                assert.ok(failure instanceof AggregateError);
                assert.deepEqual(failure.errors, [
                    originalFailure,
                    persistenceFailure,
                ]);
                assert.strictEqual(failure.cause, originalFailure);
                return true;
            }
        );
    });

    it('preserves both the propagated iteration and final teardown failures', async () => {
        const iterationFailure = new Error('fixed-iteration-failure');
        const teardownFailure = new Error('fixed-teardown-failure');

        await assert.rejects(
            runXtreamFinalTeardown(
                async () => {
                    throw teardownFailure;
                },
                { failure: iterationFailure }
            ),
            (failure: unknown) => {
                assert.ok(failure instanceof AggregateError);
                assert.deepEqual(failure.errors, [
                    iterationFailure,
                    teardownFailure,
                ]);
                assert.strictEqual(failure.cause, iterationFailure);
                return true;
            }
        );
    });

    it('preserves an exact teardown failure when the iteration succeeded', async () => {
        const teardownFailure = new Error('fixed-teardown-failure');

        await assert.rejects(
            runXtreamFinalTeardown(async () => {
                throw teardownFailure;
            }, null),
            (failure: unknown) => failure === teardownFailure
        );
    });

    it('collects failure evidence before teardown and writes summary before its guard', () => {
        const iteration = readFileSync(
            resolve(performanceDirectory, 'xtream-benchmark-iteration.ts'),
            'utf8'
        );
        const failureCatch = iteration.indexOf('} catch (failure) {');
        const failurePersistence = iteration.indexOf(
            'persistXtreamIterationFailureEvidenceAndThrow(',
            failureCatch
        );
        const teardown = iteration.indexOf('} finally {', failureCatch);
        const preservingTeardown = iteration.indexOf(
            'runXtreamFinalTeardown(',
            teardown
        );

        assert.ok(failureCatch >= 0, 'iteration failure catch is missing');
        assert.ok(
            failurePersistence > failureCatch,
            'failure evidence persistence is missing'
        );
        assert.ok(
            teardown > failurePersistence,
            'teardown occurs before failure evidence persistence'
        );
        assert.ok(
            preservingTeardown > teardown,
            'final teardown does not preserve an iteration failure'
        );
        assert.doesNotMatch(
            iteration.slice(failureCatch, teardown),
            /if \(captureInstalled\)/u,
            'early capture-setup failure metadata is incorrectly gated'
        );
        assert.match(iteration, /createXtreamSingleAttemptCapture/);
        const seededBranch = iteration.indexOf('if (seeded) {');
        const seedStop = iteration.indexOf(
            'stopMainCaptureOnce = createXtreamSingleAttemptCapture',
            seededBranch
        );
        const seedRun = iteration.indexOf(
            'await seedXtreamExistingPortal',
            seededBranch
        );
        assert.ok(
            seedStop > seededBranch && seedRun > seedStop,
            'seed capture does not have failure finalization armed'
        );

        const orchestrator = readFileSync(
            resolve(performanceDirectory, 'xtream-benchmark-orchestrator.ts'),
            'utf8'
        );
        const summaryWrite = orchestrator.indexOf(
            "join(configuration.outputDirectory, 'summary.json')"
        );
        const validityGuard = orchestrator.indexOf(
            'summary.validForComparison !=='
        );
        assert.ok(summaryWrite >= 0, 'summary persistence is missing');
        assert.ok(
            validityGuard > summaryWrite,
            'comparison-validity guard runs before summary persistence'
        );
    });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import { createXtreamAssemblerFixture } from './xtream-iteration-assembler.fixture';
import { assembleXtreamRawIteration } from './xtream-iteration-assembler';
import { summarizeXtreamUiActionSamples } from './xtream-ui-action-probe';

describe('Xtream raw iteration assembler background UI evidence', () => {
    it('binds samples to the full refresh lifecycle after the delete prelude', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.BACKGROUND_UI
        );
        const request = input.mainCapture.requests.find(
            ({ operation }) => operation === 'DB_DELETE_XTREAM_CONTENT'
        );
        const background = input.terminal.backgroundProbe;
        const operation = input.terminal.operation;
        const storeTerminalEpochMs =
            input.rendererCapture.probe.storeTerminalEpochMs;
        assert.ok(request?.workStartedEpochMs);
        assert.ok(request.workEndedEpochMs);
        assert.ok(background);
        assert.ok(operation);
        assert.ok(storeTerminalEpochMs);
        const step = (storeTerminalEpochMs - request.workEndedEpochMs) / 12;
        assert.ok(step > 0);
        const samples = background.result.samples.map((sample, index) => {
            const startEpochMs =
                Number(request.workEndedEpochMs) + step * (index * 2 + 1);
            const endEpochMs = startEpochMs + step;
            return {
                ...sample,
                endEpochMs,
                latencyMs: step,
                startEpochMs,
            };
        });
        const summary = summarizeXtreamUiActionSamples(samples);

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                terminal: {
                    ...input.terminal,
                    backgroundProbe: {
                        ...background,
                        completedEpochMs: samples.at(-1)?.endEpochMs ?? 0,
                        result: {
                            ...summary,
                            dashboardPaintVisibility: 'visible-without-overlay',
                            samples,
                        },
                        startedEpochMs: request.workStartedEpochMs,
                    },
                    operation: {
                        ...operation,
                        terminalEpochMs: request.workEndedEpochMs,
                    },
                },
            })
        );
    });

    it('accepts samples that finish before the delete prelude completes', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.BACKGROUND_UI
        );
        const request = input.mainCapture.requests.find(
            ({ operation }) => operation === 'DB_DELETE_XTREAM_CONTENT'
        );
        const background = input.terminal.backgroundProbe;
        const operation = input.terminal.operation;
        assert.ok(request?.workStartedEpochMs);
        assert.ok(request.workEndedEpochMs);
        assert.ok(background);
        assert.ok(operation);
        const step =
            (request.workEndedEpochMs - background.startedEpochMs) / 12;
        assert.ok(step > 0);
        const samples = background.result.samples.map((sample, index) => {
            const startEpochMs =
                background.startedEpochMs + step * (index * 2 + 1);
            const endEpochMs = startEpochMs + step;
            return {
                ...sample,
                endEpochMs,
                latencyMs: step,
                startEpochMs,
            };
        });
        const summary = summarizeXtreamUiActionSamples(samples);
        assert.ok(
            Number(samples.at(-1)?.endEpochMs) < request.workEndedEpochMs
        );

        assert.doesNotThrow(() =>
            assembleXtreamRawIteration({
                ...input,
                terminal: {
                    ...input.terminal,
                    backgroundProbe: {
                        ...background,
                        completedEpochMs: samples.at(-1)?.endEpochMs ?? 0,
                        result: {
                            ...summary,
                            dashboardPaintVisibility: 'visible-without-overlay',
                            samples,
                        },
                    },
                    operation: {
                        ...operation,
                        terminalEpochMs: request.workEndedEpochMs,
                    },
                },
            })
        );
    });

    it('rejects overlapping samples', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.BACKGROUND_UI
        );
        const background = input.terminal.backgroundProbe;
        assert.ok(background);
        const samples = background.result.samples.map((sample, index, all) => {
            if (index !== 1) return sample;
            const previous = all[0];
            assert.ok(previous);
            const startEpochMs = previous.endEpochMs - 0.1;
            return {
                ...sample,
                latencyMs: sample.endEpochMs - startEpochMs,
                startEpochMs,
            };
        });
        const summary = summarizeXtreamUiActionSamples(samples);

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    terminal: {
                        ...input.terminal,
                        backgroundProbe: {
                            ...background,
                            result: {
                                ...summary,
                                dashboardPaintVisibility:
                                    'visible-without-overlay',
                                samples,
                            },
                        },
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });

    it('rejects a sample after the final refresh store terminal', () => {
        const input = createXtreamAssemblerFixture(
            XTREAM_SCENARIO_ID.BACKGROUND_UI
        );
        const background = input.terminal.backgroundProbe;
        const storeTerminalEpochMs =
            input.rendererCapture.probe.storeTerminalEpochMs;
        assert.ok(background);
        assert.ok(storeTerminalEpochMs);
        const samples = background.result.samples.map((sample, index, all) => {
            if (index !== all.length - 1) return sample;
            const endEpochMs = storeTerminalEpochMs + 0.1;
            return {
                ...sample,
                endEpochMs,
                latencyMs: endEpochMs - sample.startEpochMs,
            };
        });
        const summary = summarizeXtreamUiActionSamples(samples);

        assert.throws(
            () =>
                assembleXtreamRawIteration({
                    ...input,
                    terminal: {
                        ...input.terminal,
                        backgroundProbe: {
                            ...background,
                            completedEpochMs: samples.at(-1)?.endEpochMs ?? 0,
                            result: {
                                ...summary,
                                dashboardPaintVisibility:
                                    'visible-without-overlay',
                                samples,
                            },
                        },
                    },
                }),
            /xtream-iteration-assembly-invalid/
        );
    });
});

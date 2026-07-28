import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import {
    createXtreamRendererConsoleErrorBreakdown,
    recordXtreamRendererConsoleError,
    validXtreamRendererConsoleErrorEvidence,
} from './xtream-renderer-console-errors';

const cancelledInvoke =
    'Error invoking remote method DB_SAVE_CONTENT: AbortError: ' +
    'Operation "save-content" was cancelled';

describe('Xtream renderer console error evidence', () => {
    it('accepts only the exact three current IPC cancellation errors', () => {
        const exact = createXtreamRendererConsoleErrorBreakdown();
        for (const message of [
            `Error saving Xtream content: ${cancelledInvoke}`,
            `[withContent] Error fetching content ${cancelledInvoke}`,
            `[withContent] Error initializing content ${cancelledInvoke}`,
        ]) {
            recordXtreamRendererConsoleError(
                exact,
                XTREAM_SCENARIO_ID.CANCEL_IMPORT,
                message
            );
        }

        assert.equal(
            validXtreamRendererConsoleErrorEvidence(
                3,
                exact,
                XTREAM_SCENARIO_ID.CANCEL_IMPORT
            ),
            true
        );
        assert.equal(
            validXtreamRendererConsoleErrorEvidence(
                3,
                exact,
                XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
            ),
            false
        );

        for (const messages of [
            ['generic error', 'generic error', 'generic error'],
            [
                `Error saving Xtream content: ${cancelledInvoke}`,
                `[withContent] Error fetching content ${cancelledInvoke}`,
            ],
            [
                `Error saving Xtream content: ${cancelledInvoke}`,
                `[withContent] Error fetching content ${cancelledInvoke}`,
                `[withContent] Error fetching content ${cancelledInvoke}`,
            ],
            [
                'Error saving Xtream content: request failed',
                '[withContent] Error fetching content request failed',
                '[withContent] Error initializing content request failed',
            ],
            [
                `Error saving Xtream content: ${cancelledInvoke}`,
                `[withContent] Error fetching content ${cancelledInvoke}`,
                `[withContent] Error initializing content ${cancelledInvoke}`,
                'unexpected fourth error',
            ],
        ]) {
            const candidate = createXtreamRendererConsoleErrorBreakdown();
            for (const message of messages) {
                recordXtreamRendererConsoleError(
                    candidate,
                    XTREAM_SCENARIO_ID.CANCEL_IMPORT,
                    message
                );
            }
            assert.equal(
                validXtreamRendererConsoleErrorEvidence(
                    messages.length,
                    candidate,
                    XTREAM_SCENARIO_ID.CANCEL_IMPORT
                ),
                false
            );
        }
    });
});

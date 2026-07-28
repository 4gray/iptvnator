import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { XtreamCodeActions } from '@iptvnator/shared/interfaces';

import { XTREAM_SCENARIO_ID } from './xtream-benchmark-contract';
import {
    attributeXtreamPhases,
    XTREAM_ATTRIBUTION_PHASE as PHASE,
} from './xtream-phase-attribution';
import { scenarioCapture } from './xtream-phase-attribution.fixtures';
import {
    phaseEpoch,
    relabelInterleavedCategoryRequests,
    swapProviderTimelines,
} from './xtream-phase-topology.fixtures';
import type { XtreamPhaseProviderAction } from './xtream-phase-semantic-source';

describe('Xtream request-level phase topology', () => {
    it('never consumes caller-owned event or IPC iterators', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const invoked: string[] = [];
        const events: (typeof initial.events)[number][] = [];
        const ipcSpans: (typeof initial.ipcSpans)[number][] = [];
        Object.defineProperty(events, Symbol.iterator, {
            value() {
                invoked.push('events');
                return initial.events[Symbol.iterator]();
            },
        });
        Object.defineProperty(ipcSpans, Symbol.iterator, {
            value() {
                invoked.push('ipcSpans');
                return initial.ipcSpans[Symbol.iterator]();
            },
        });

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events, ipcSpans }),
            /invalid Xtream phase capture/
        );
        assert.deepEqual(invoked, []);
    });

    it('rejects own phase-capture array keys beyond dense indices and length', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = [...initial.events];
        const ipcSpans = [...initial.ipcSpans];
        Object.defineProperty(events, 'map', {
            value: Array.prototype.map.bind(events),
        });
        Object.defineProperty(ipcSpans, Symbol('extra'), { value: true });

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events }),
            /invalid Xtream phase capture/
        );
        assert.throws(
            () => attributeXtreamPhases({ ...initial, ipcSpans }),
            /invalid Xtream phase capture/
        );
    });

    it('rejects accessor-backed event and IPC records without invoking them', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const invoked: string[] = [];
        const event = { ...initial.events[0] };
        const ipcSpan = { ...initial.ipcSpans[0] };
        Object.defineProperty(event, 'phase', {
            enumerable: true,
            get() {
                invoked.push('event.phase');
                return initial.events[0]?.phase;
            },
        });
        Object.defineProperty(ipcSpan, 'method', {
            enumerable: true,
            get() {
                invoked.push('ipcSpan.method');
                return initial.ipcSpans[0]?.method;
            },
        });

        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...initial,
                    events: [event, ...initial.events.slice(1)],
                }),
            /invalid Xtream phase capture/
        );
        assert.throws(
            () =>
                attributeXtreamPhases({
                    ...initial,
                    ipcSpans: [ipcSpan, ...initial.ipcSpans.slice(1)],
                }),
            /invalid Xtream phase capture/
        );
        assert.deepEqual(invoked, []);
    });

    it('requires category phases to preserve request correlation and order', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const write = initial.events.find(
            ({ boundary, phase }) =>
                boundary === 'start' &&
                phase === PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS
        );
        assert.ok(write);
        const writeBeforeNormalize = initial.events.map((event) =>
            event.phase === PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS &&
            event.correlationId === write.correlationId
                ? {
                      ...event,
                      epochMs:
                          initial.operationStartEpochMs +
                          (event.boundary === 'end'
                              ? Number(event.durationMs)
                              : 0),
                  }
                : event
        );
        const mismatchedRequest = initial.events.map((event) =>
            event.phase === PHASE.SQLITE_CATEGORIES_WRITE_TRANSACTIONS &&
            event.correlationId === write.correlationId
                ? { ...event, correlationId: 'mismatched-category-request' }
                : event
        );

        for (const events of [writeBeforeNormalize, mismatchedRequest]) {
            assert.throws(
                () => attributeXtreamPhases({ ...initial, events }),
                /invalid Xtream phase capture/
            );
        }
    });

    it('rejects one worker request identity reused by different operations', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const chainedReuse = initial.events.map((event) =>
            event.correlationId === 'content-save-0' &&
            new Set<string>([
                PHASE.SQLITE_CONTENT_CATEGORY_MAP_READ,
                PHASE.NORMALIZE_CONTENT,
                PHASE.SQLITE_CONTENT_WRITE_TRANSACTIONS,
            ]).has(event.phase)
                ? { ...event, correlationId: 'category-save-0' }
                : event
        );
        const standaloneReuse = initial.events.map((event) =>
            event.correlationId === 'content-read-0-pre'
                ? { ...event, correlationId: 'category-read-0-pre' }
                : event
        );

        for (const events of [chainedReuse, standaloneReuse]) {
            assert.throws(
                () => attributeXtreamPhases({ ...initial, events }),
                /invalid Xtream phase capture/
            );
        }
    });

    it('rejects equal-count VOD and series category phases relabeled across worker requests', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = relabelInterleavedCategoryRequests(initial.events);

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events }),
            /invalid Xtream phase capture/
        );
    });

    it('rejects category and content worker requests split across source domains', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        for (const [correlationId, phase, providerAction] of [
            [
                'category-save-0',
                PHASE.NORMALIZE_CATEGORIES,
                XtreamCodeActions.GetLiveCategories,
            ],
            [
                'content-save-1',
                PHASE.NORMALIZE_CONTENT,
                XtreamCodeActions.GetVodStreams,
            ],
        ] as const) {
            const events = initial.events.map((event) =>
                event.correlationId === correlationId && event.phase === phase
                    ? {
                          ...event,
                          categoryType: null,
                          contentType: null,
                          providerAction:
                              providerAction as XtreamPhaseProviderAction,
                      }
                    : event
            );
            assert.throws(
                () => attributeXtreamPhases({ ...initial, events }),
                /invalid Xtream phase capture/
            );
        }
    });

    it('rejects one IPC identity reused by different methods', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const ipcSpans = initial.ipcSpans.map((span) =>
            span.correlationId === 'dbGetCategories-0'
                ? { ...span, correlationId: 'dbUpsertAppPlaylist-0' }
                : span
        );

        assert.throws(
            () => attributeXtreamPhases({ ...initial, ipcSpans }),
            /invalid Xtream phase capture/
        );
    });

    it('rejects a provider response that becomes ready after its consumer DB and store stages', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const liveStoreEnd = phaseEpoch(
            initial.events,
            PHASE.STORE_PUBLISH_LIVE,
            'end'
        );
        const lateStart = liveStoreEnd + 1;
        const events = initial.events.map((event) => {
            if (event.correlationId !== 'provider-content-0') return event;
            const phaseOffset =
                event.phase === PHASE.NETWORK_TOTAL
                    ? 0
                    : event.phase === PHASE.JSON_TRANSFORM
                      ? 1
                      : 5;
            const duration =
                event.phase === PHASE.NETWORK_TOTAL
                    ? 4
                    : event.phase === PHASE.JSON_TRANSFORM
                      ? 1
                      : 1;
            return {
                ...event,
                epochMs:
                    lateStart +
                    phaseOffset +
                    (event.boundary === 'end' ? duration : 0),
            };
        });

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events }),
            /invalid Xtream phase capture/
        );
    });

    it('rejects swapping the account provider lifecycle with a category lifecycle', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = swapProviderTimelines(
            initial.events,
            'provider-account',
            'provider-category-0'
        );

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events }),
            /invalid Xtream phase capture/
        );
    });

    it('keeps parallel category completion order independent of category type', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = swapProviderTimelines(
            initial.events,
            'provider-category-0',
            'provider-category-1'
        );

        assert.doesNotThrow(() =>
            attributeXtreamPhases({ ...initial, events })
        );
    });

    it('rejects swapping sequential live and VOD provider lifecycles', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = swapProviderTimelines(
            initial.events,
            'provider-content-0',
            'provider-content-1'
        );

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events }),
            /invalid Xtream phase capture/
        );
    });

    it('derives provider semantics from the persisted typed action source', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const events = initial.events.map((event) =>
            event.correlationId === 'provider-content-0'
                ? {
                      ...event,
                      providerAction:
                          XtreamCodeActions.GetVodStreams as XtreamPhaseProviderAction,
                  }
                : event
        );

        assert.throws(
            () => attributeXtreamPhases({ ...initial, events }),
            /invalid Xtream phase capture/
        );
    });
});

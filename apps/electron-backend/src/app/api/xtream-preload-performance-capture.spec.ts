import {
    XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION,
    type XtreamPreloadPerformanceMarker,
} from '@iptvnator/shared/interfaces';
import { XtreamCodeActions } from '@iptvnator/shared/interfaces';
import { createXtreamPreloadPerformanceCapture } from './xtream-preload-performance-capture';

const MARKER_KEYS = [
    'action',
    'boundary',
    'categoryType',
    'contentType',
    'ipcCallId',
    'itemCount',
    'method',
    'operationId',
    'outcome',
    'playlistId',
    'schemaVersion',
    'sessionId',
    'sourceEpochMs',
] as const;

const EMPTY_METADATA = {
    action: null,
    categoryType: null,
    contentType: null,
    itemCount: null,
    operationId: null,
    playlistId: null,
    sessionId: null,
} as const;

describe('Xtream preload performance capture contract', () => {
    it.each([
        {
            args: [
                {
                    params: { action: XtreamCodeActions.GetLiveStreams },
                    sessionId: 'session-1',
                },
            ],
            expected: {
                ...EMPTY_METADATA,
                action: XtreamCodeActions.GetLiveStreams,
                sessionId: 'session-1',
            },
            method: 'xtreamRequest',
        },
        {
            args: ['session-2'],
            expected: { ...EMPTY_METADATA, sessionId: 'session-2' },
            method: 'xtreamCancelSession',
        },
        {
            args: ['playlist-1', 'movies'],
            expected: {
                ...EMPTY_METADATA,
                categoryType: 'movies',
                playlistId: 'playlist-1',
            },
            method: 'dbGetCategories',
        },
        {
            args: ['playlist-2', [{}, {}, {}], 'live', [99]],
            expected: {
                ...EMPTY_METADATA,
                categoryType: 'live',
                itemCount: 3,
                playlistId: 'playlist-2',
            },
            method: 'dbSaveCategories',
        },
        {
            args: ['playlist-3', 'series'],
            expected: {
                ...EMPTY_METADATA,
                contentType: 'series',
                playlistId: 'playlist-3',
            },
            method: 'dbGetContent',
        },
        {
            args: ['playlist-4', [{}, {}], 'movie', 'operation-4'],
            expected: {
                ...EMPTY_METADATA,
                contentType: 'movie',
                itemCount: 2,
                operationId: 'operation-4',
                playlistId: 'playlist-4',
            },
            method: 'dbSaveContent',
        },
        {
            args: ['playlist-5', 'operation-5'],
            expected: {
                ...EMPTY_METADATA,
                operationId: 'operation-5',
                playlistId: 'playlist-5',
            },
            method: 'dbDeleteXtreamContent',
        },
        {
            args: ['playlist-6', 'operation-6'],
            expected: {
                ...EMPTY_METADATA,
                operationId: 'operation-6',
                playlistId: 'playlist-6',
            },
            method: 'dbDeletePlaylist',
        },
        {
            args: ['playlist-7', [{}, {}], [{}], 'operation-7'],
            expected: {
                ...EMPTY_METADATA,
                itemCount: 3,
                operationId: 'operation-7',
                playlistId: 'playlist-7',
            },
            method: 'dbRestoreXtreamUserData',
        },
        {
            args: ['playlist-8', 'provider search', ['live'], true],
            expected: {
                ...EMPTY_METADATA,
                playlistId: 'playlist-8',
            },
            method: 'dbSearchContent',
        },
        {
            args: ['provider search', ['live'], true, [{ id: 'source-1' }]],
            expected: EMPTY_METADATA,
            method: 'dbGlobalSearch',
        },
        {
            args: ['operation-9'],
            expected: { ...EMPTY_METADATA, operationId: 'operation-9' },
            method: 'dbCancelOperation',
        },
    ] as const)(
        'extracts only safe positional metadata for $method',
        ({ args, expected, method }) => {
            const sendMarker = jest.fn();
            const capture = createXtreamPreloadPerformanceCapture(
                true,
                sendMarker,
                () => 1_000.25
            );

            const call = capture.start(method, args);

            expect(call).not.toBeNull();
            expect(sendMarker).toHaveBeenCalledWith(
                XTREAM_PRELOAD_PERFORMANCE_MARKER_CHANNEL,
                {
                    ...expected,
                    boundary: 'start',
                    ipcCallId: 1,
                    method,
                    outcome: null,
                    schemaVersion: XTREAM_PRELOAD_PERFORMANCE_SCHEMA_VERSION,
                    sourceEpochMs: 1_000.25,
                }
            );
        }
    );

    it('emits fixed-key start and end markers with matching call metadata', () => {
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 2_000.5
        );

        const successCall = capture.start('dbGetContent', [
            'playlist-1',
            'live',
        ]);
        capture.success(successCall);
        const errorCall = capture.start('dbCancelOperation', ['operation-2']);
        capture.error(errorCall);

        expect(
            markers.map(({ boundary, ipcCallId, outcome }) => ({
                boundary,
                ipcCallId,
                outcome,
            }))
        ).toEqual([
            { boundary: 'start', ipcCallId: 1, outcome: null },
            { boundary: 'end', ipcCallId: 1, outcome: 'success' },
            { boundary: 'start', ipcCallId: 2, outcome: null },
            { boundary: 'end', ipcCallId: 2, outcome: 'error' },
        ]);
        for (const marker of markers) {
            expect(Object.keys(marker).sort()).toEqual([...MARKER_KEYS].sort());
        }
    });

    it('allows every current Xtream action including the legacy alias', () => {
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 3_000
        );
        const actions = Object.values(XtreamCodeActions);

        for (const action of actions) {
            capture.start('xtreamRequest', [{ params: { action } }]);
        }

        expect(markers.map(({ action }) => action)).toEqual(actions);
        expect(actions).toContain('get_simple_data_table');
        expect(actions).toContain('get_simple_date_table');
    });
});

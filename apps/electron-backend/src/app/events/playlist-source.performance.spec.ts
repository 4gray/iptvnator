import {
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    M3U_IMPORT_PERFORMANCE_PHASE,
    type PerformancePhaseEvent,
} from '@iptvnator/shared/interfaces';

import {
    createM3uImportPerformanceCapture,
    type M3uImportPerformanceCaptureRuntime,
} from './playlist-import-performance';
import { fetchPlaylistFromUrl } from './playlist-source';

const mockCreatePlaylistObject = jest.fn();
const mockGetFilenameFromUrl = jest.fn();
const mockParse = jest.fn();
const mockRequestWithValidatedRedirects = jest.fn();

jest.mock('@iptvnator/shared/m3u-utils', () => ({
    createPlaylistObject: (...args: unknown[]) =>
        mockCreatePlaylistObject(...args),
    getFilenameFromUrl: (...args: unknown[]) => mockGetFilenameFromUrl(...args),
}));

jest.mock('iptv-playlist-parser', () => ({
    parse: (...args: unknown[]) => mockParse(...args),
}));

jest.mock('../util/secure-https', () => ({
    createPlaylistAgentFactory: jest.fn(() => jest.fn()),
}));

jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: (...args: unknown[]) =>
        mockRequestWithValidatedRedirects(...args),
}));

type ImportPhaseEvent = PerformancePhaseEvent<
    (typeof M3U_IMPORT_PERFORMANCE_PHASE)[keyof typeof M3U_IMPORT_PERFORMANCE_PHASE]
>;

function createRuntime(): M3uImportPerformanceCaptureRuntime {
    const epochValues = [100, 110, 120, 130, 140, 150];
    const monotonicValues = [10, 14, 20, 23, 30, 36];

    return {
        createRequestId: jest.fn(() => 'm3u-request-1'),
        readEpochMs: jest.fn(() => epochValues.shift() ?? 150),
        readMonotonicMs: jest.fn(() => monotonicValues.shift() ?? 36),
    };
}

describe('URL playlist import performance phases', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => {
        mockCreatePlaylistObject.mockReset();
        mockGetFilenameFromUrl.mockReset();
        mockParse.mockReset();
        mockRequestWithValidatedRedirects.mockReset();
    });

    it('does not allocate phase state or read clocks while capture is disabled', async () => {
        const runtime = {
            createRequestId: jest.fn(() => {
                throw new Error('request id must stay untouched');
            }),
            readEpochMs: jest.fn(() => {
                throw new Error('epoch clock must stay untouched');
            }),
            readMonotonicMs: jest.fn(() => {
                throw new Error('monotonic clock must stay untouched');
            }),
        };
        const emit = jest.fn();
        const playlist = { playlist: { items: [] }, title: 'Synthetic' };

        mockRequestWithValidatedRedirects.mockResolvedValue({
            data: '#EXTM3U',
        });
        mockParse.mockReturnValue({ items: [] });
        mockGetFilenameFromUrl.mockReturnValue('synthetic.m3u');
        mockCreatePlaylistObject.mockReturnValue(playlist);

        const capture = createM3uImportPerformanceCapture({
            emit,
            enabled: false,
            runtime,
        });
        const result = await fetchPlaylistFromUrl(
            'http://127.0.0.1:43210/synthetic-performance.m3u',
            undefined,
            { performanceCapture: capture }
        );

        expect(capture).toBeNull();
        expect(result).toBe(playlist);
        expect(emit).not.toHaveBeenCalled();
        expect(runtime.createRequestId).not.toHaveBeenCalled();
        expect(runtime.readEpochMs).not.toHaveBeenCalled();
        expect(runtime.readMonotonicMs).not.toHaveBeenCalled();
    });

    it('emits ordered epoch-aligned pairs with durations and only byte/item metadata', async () => {
        const events: ImportPhaseEvent[] = [];
        const body = '#EXTM3U\n#EXTINF:-1,One\nhttps://stream.test/1';
        const bodyBytes = Buffer.byteLength(body, 'utf8');
        const parsed = { items: [{ name: 'One' }, { name: 'Two' }] };
        const playlist = {
            playlist: { items: parsed.items },
            title: 'Synthetic',
        };

        mockRequestWithValidatedRedirects.mockResolvedValue({
            data: body,
            headers: {
                'content-length': String(bodyBytes),
            },
        });
        mockParse.mockReturnValue(parsed);
        mockGetFilenameFromUrl.mockReturnValue('synthetic.m3u');
        mockCreatePlaylistObject.mockReturnValue(playlist);

        const capture = createM3uImportPerformanceCapture({
            emit: (event) => events.push(event),
            enabled: true,
            requestId: 'm3u-request-1',
            runtime: createRuntime(),
        });
        const byteLength = jest.spyOn(Buffer, 'byteLength');
        const result = await fetchPlaylistFromUrl(
            'http://127.0.0.1:43210/synthetic-performance.m3u',
            undefined,
            { performanceCapture: capture }
        );

        expect(result).toBe(playlist);
        expect(byteLength).not.toHaveBeenCalled();
        expect(
            events.map(
                ({
                    boundary,
                    durationMs,
                    epochMs,
                    metadata,
                    phase,
                    requestId,
                }) => ({
                    boundary,
                    durationMs,
                    epochMs,
                    metadata,
                    phase,
                    requestId,
                })
            )
        ).toEqual([
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 100,
                metadata: undefined,
                phase: M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
                requestId: 'm3u-request-1',
            },
            {
                boundary: 'end',
                durationMs: 4,
                epochMs: 110,
                metadata: { byteCount: bodyBytes },
                phase: M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
                requestId: 'm3u-request-1',
            },
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 120,
                metadata: undefined,
                phase: M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U,
                requestId: 'm3u-request-1',
            },
            {
                boundary: 'end',
                durationMs: 3,
                epochMs: 130,
                metadata: { itemCount: 2 },
                phase: M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U,
                requestId: 'm3u-request-1',
            },
            {
                boundary: 'start',
                durationMs: null,
                epochMs: 140,
                metadata: undefined,
                phase: M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
                requestId: 'm3u-request-1',
            },
            {
                boundary: 'end',
                durationMs: 6,
                epochMs: 150,
                metadata: { itemCount: 2 },
                phase: M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
                requestId: 'm3u-request-1',
            },
        ]);
        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain('127.0.0.1');
        expect(serialized).not.toContain('stream.test');
        expect(serialized).not.toContain('Synthetic');
        expect(serialized).not.toContain('username');
        expect(serialized).not.toContain('password');
        expect(serialized).not.toContain(
            APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE
        );
    });

    it('preserves exact results and errors when event or metadata hooks fail', async () => {
        const resultIdentity = { result: 'same-object' };
        const capture = createM3uImportPerformanceCapture({
            emit: () => {
                throw new Error('event sink failed');
            },
            enabled: true,
            requestId: 'm3u-request-2',
            runtime: createRuntime(),
        });

        expect(
            capture?.measure(
                M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
                () => resultIdentity,
                () => {
                    throw new Error('metadata failed');
                }
            )
        ).toBe(resultIdentity);

        const businessError = new Error('download failed');
        const events: ImportPhaseEvent[] = [];
        mockRequestWithValidatedRedirects.mockRejectedValue(businessError);
        const errorCapture = createM3uImportPerformanceCapture({
            emit: (event) => events.push(event),
            enabled: true,
            requestId: 'm3u-request-3',
            runtime: createRuntime(),
        });

        await expect(
            fetchPlaylistFromUrl(
                'http://127.0.0.1:43210/failure.m3u',
                undefined,
                {
                    performanceCapture: errorCapture,
                }
            )
        ).rejects.toBe(businessError);
        expect(
            events.map(({ boundary, phase }) => ({ boundary, phase }))
        ).toEqual([
            {
                boundary: 'start',
                phase: M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
            },
            {
                boundary: 'end',
                phase: M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
            },
        ]);
    });

    it('samples the end boundary before creating phase metadata', () => {
        const events: ImportPhaseEvent[] = [];
        let epochMs = 100;
        let monotonicMs = 10;
        const resultIdentity = { itemCount: 2 };
        const capture = createM3uImportPerformanceCapture({
            emit: (event) => events.push(event),
            enabled: true,
            requestId: 'm3u-request-boundary',
            runtime: {
                createRequestId: jest.fn(() => 'unused-request-id'),
                readEpochMs: jest.fn(() => epochMs),
                readMonotonicMs: jest.fn(() => monotonicMs),
            },
        });

        const result = capture?.measure(
            M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
            () => {
                epochMs = 110;
                monotonicMs = 20;
                return resultIdentity;
            },
            ({ itemCount }) => {
                epochMs = 1_110;
                monotonicMs = 1_020;
                return { itemCount };
            }
        );

        expect(result).toBe(resultIdentity);
        expect(events).toHaveLength(2);
        expect(events[1]).toMatchObject({
            boundary: 'end',
            durationMs: 10,
            epochMs: 110,
            metadata: { itemCount: 2 },
        });
    });
});

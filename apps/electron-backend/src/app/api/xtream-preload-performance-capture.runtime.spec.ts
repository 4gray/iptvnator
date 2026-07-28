import type { XtreamPreloadPerformanceMarker } from '@iptvnator/shared/interfaces';
import { createXtreamPreloadPerformanceCapture } from './xtream-preload-performance-capture';

describe('Xtream preload performance capture runtime', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does zero target metadata or clock work when disabled', () => {
        const clock = jest.fn(() => {
            throw new Error('clock must not run');
        });
        const sendMarker = jest.fn();
        const args = new Proxy([{}], {
            get: () => {
                throw new Error('metadata must not run');
            },
        });
        const capture = createXtreamPreloadPerformanceCapture(
            false,
            sendMarker,
            clock
        );

        expect(capture.start('xtreamRequest', args)).toBeNull();
        expect(capture.start('updateSettings', args)).toBeNull();
        capture.success(null);
        capture.error(null);

        expect(clock).not.toHaveBeenCalled();
        expect(sendMarker).not.toHaveBeenCalled();
    });

    it('keeps calls independent with positive ids and nondecreasing finite timestamps', () => {
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const clockValues = [10.5, 9.5, Number.NaN, 11.25];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => clockValues.shift() as number
        );

        const first = capture.start('dbGetContent', ['playlist-1', 'live']);
        const second = capture.start('dbGetContent', ['playlist-2', 'movie']);
        capture.success(second);
        capture.error(first);

        expect(
            markers.map(({ boundary, ipcCallId, outcome }) => ({
                boundary,
                ipcCallId,
                outcome,
            }))
        ).toEqual([
            { boundary: 'start', ipcCallId: 1, outcome: null },
            { boundary: 'start', ipcCallId: 2, outcome: null },
            { boundary: 'end', ipcCallId: 2, outcome: 'success' },
            { boundary: 'end', ipcCallId: 1, outcome: 'error' },
        ]);
        expect(
            markers.every(({ sourceEpochMs }) => Number.isFinite(sourceEpochMs))
        ).toBe(true);
        expect(markers.map(({ sourceEpochMs }) => sourceEpochMs)).toEqual([
            10.5, 10.5, 10.5, 11.25,
        ]);
    });

    it.each([
        ['non-finite', () => Number.NaN],
        [
            'throwing',
            () => {
                throw new Error('clock failure');
            },
        ],
    ])(
        'uses a positive finite epoch fallback for a first %s clock sample',
        (_description, clock) => {
            jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
            const markers: XtreamPreloadPerformanceMarker[] = [];
            const capture = createXtreamPreloadPerformanceCapture(
                true,
                (_channel, marker) => markers.push(marker),
                clock
            );

            capture.start('dbGetContent', ['playlist-1', 'live']);

            expect(markers[0].sourceEpochMs).toBe(1_700_000_000_000);
            expect(markers[0].sourceEpochMs).toBeGreaterThan(0);
            expect(Number.isFinite(markers[0].sourceEpochMs)).toBe(true);
        }
    );

    it('swallows sink and clock failures without inspecting result or error values', () => {
        const result = new Proxy(
            {},
            {
                get: () => {
                    throw new Error('result must stay opaque');
                },
            }
        );
        const error = new Proxy(
            {},
            {
                get: () => {
                    throw new Error('error must stay opaque');
                },
            }
        );
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            () => {
                throw new Error('sink failure');
            },
            () => {
                throw new Error('clock failure');
            }
        );

        const call = capture.start('dbGetContent', ['playlist-1', 'live']);

        expect(() => capture.success(call, result)).not.toThrow();
        expect(() => capture.error(call, error)).not.toThrow();
    });
});

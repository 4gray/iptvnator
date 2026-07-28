import type { XtreamPreloadPerformanceMarker } from '@iptvnator/shared/interfaces';
import { createXtreamPreloadPerformanceCapture } from './xtream-preload-performance-capture';

describe('Xtream preload performance capture safety', () => {
    it.each([
        ['', null],
        [' ', null],
        ['-leading-dash', null],
        ['contains space', null],
        ['contains/slash', null],
        ['x'.repeat(129), null],
        [' playlist.ok:1 ', null],
        ['playlist.ok:1', 'playlist.ok:1'],
        ['A', 'A'],
    ])('normalizes identifier %p to %p', (identifier, expected) => {
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 1_000
        );

        capture.start('dbDeletePlaylist', [identifier, identifier]);

        expect(markers[0]).toMatchObject({
            operationId: expected,
            playlistId: expected,
        });
    });

    it.each([
        ['xtreamRequest', [{ params: { action: 'provider-action-secret' } }]],
        ['dbGetCategories', ['playlist-1', 'vod']],
        ['dbGetCategories', ['playlist-1', 'LIVE']],
        ['dbGetContent', ['playlist-1', 'movies']],
        ['dbGetContent', ['playlist-1', 'vod']],
    ] as const)(
        'turns invalid action or type metadata into null for %s',
        (method, args) => {
            const markers: XtreamPreloadPerformanceMarker[] = [];
            const capture = createXtreamPreloadPerformanceCapture(
                true,
                (_channel, marker) => markers.push(marker),
                () => 1_000
            );

            capture.start(method, args);

            expect(markers[0]).toMatchObject({
                action: null,
                categoryType: null,
                contentType: null,
            });
            expect(JSON.stringify(markers)).not.toContain(
                'provider-action-secret'
            );
        }
    );

    it('never enumerates provider payloads, reads array entries, or records forbidden strings', () => {
        const forbidden = [
            'provider-url-secret',
            'provider-user-secret',
            'provider-password-secret',
            'provider-title-secret',
            'provider-search-secret',
            'provider-result-secret',
            'provider-error-secret',
        ];
        const params = Object.defineProperties(
            { action: 'get_series' },
            {
                password: {
                    enumerable: true,
                    get: () => {
                        throw new Error(forbidden[2]);
                    },
                },
                username: {
                    enumerable: true,
                    get: () => {
                        throw new Error(forbidden[1]);
                    },
                },
            }
        );
        const payload = {
            params,
            sessionId: 'session-1',
            title: forbidden[3],
            url: forbidden[0],
        };
        const entryRead = jest.fn(() => {
            throw new Error('array entries must stay opaque');
        });
        const streams = new Array<unknown>(1);
        Object.defineProperty(streams, 0, { get: entryRead });
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 1_000
        );

        const request = capture.start('xtreamRequest', [payload]);
        capture.success(request);
        const save = capture.start('dbSaveContent', [
            'playlist-1',
            streams,
            'live',
            'operation-1',
        ]);
        capture.error(save);
        capture.start('dbSearchContent', [
            'playlist-1',
            forbidden[4],
            ['live'],
        ]);
        capture.start('dbGlobalSearch', [
            forbidden[4],
            ['live'],
            false,
            [{ title: forbidden[3] }],
        ]);

        expect(entryRead).not.toHaveBeenCalled();
        const serialized = JSON.stringify(markers);
        for (const value of forbidden) {
            expect(serialized).not.toContain(value);
        }
    });

    it('swallows hostile argument, payload, params, and array length traps', () => {
        const throwingProxy = new Proxy(
            {},
            {
                get: () => {
                    throw new Error('hostile getter');
                },
            }
        );
        const hostileArray = new Proxy([], {
            get: () => {
                throw new Error('hostile array length');
            },
        });
        const hostileArgs = new Proxy([throwingProxy], {
            get: () => {
                throw new Error('hostile args');
            },
        });
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 1_000
        );

        expect(() => capture.start('xtreamRequest', hostileArgs)).not.toThrow();
        expect(() =>
            capture.start('dbSaveCategories', [
                'playlist-1',
                hostileArray,
                'live',
            ])
        ).not.toThrow();

        expect(markers).toHaveLength(2);
        expect(markers[0]).toMatchObject({
            action: null,
            sessionId: null,
        });
        expect(markers[1].itemCount).toBeNull();
    });

    it('swallows revoked array proxies without changing the call', () => {
        const { proxy, revoke } = Proxy.revocable([], {});
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 1_000
        );
        revoke();

        expect(() =>
            capture.start('dbSaveContent', [
                'playlist-1',
                proxy,
                'live',
                'operation-1',
            ])
        ).not.toThrow();

        expect(markers[0].itemCount).toBeNull();
    });

    it('accepts only bounded array lengths and safely sums restore counts', () => {
        const markers: XtreamPreloadPerformanceMarker[] = [];
        const capture = createXtreamPreloadPerformanceCapture(
            true,
            (_channel, marker) => markers.push(marker),
            () => 1_000
        );

        capture.start('dbSaveCategories', [
            'playlist-1',
            new Array(1_000_001),
            'live',
        ]);
        capture.start('dbRestoreXtreamUserData', [
            'playlist-1',
            new Array(600_000),
            new Array(400_000),
            'operation-1',
        ]);
        capture.start('dbRestoreXtreamUserData', [
            'playlist-1',
            new Array(600_000),
            new Array(400_001),
            'operation-1',
        ]);

        expect(markers.map(({ itemCount }) => itemCount)).toEqual([
            null,
            1_000_000,
            null,
        ]);
    });
});

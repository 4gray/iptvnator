import {
    declaredAmbiguousStreamFormat,
    isAmbiguousStreamUrl,
    probeAmbiguousStreamFormat,
} from './ambiguous-stream-format.util';

describe('ambiguous stream routing', () => {
    it('never probes explicit HLS, TS, query-declared or non-http streams', () => {
        expect(isAmbiguousStreamUrl('https://example.invalid/a.m3u8')).toBe(false);
        expect(isAmbiguousStreamUrl('https://example.invalid/a.ts')).toBe(false);
        expect(isAmbiguousStreamUrl('https://example.invalid/play.php?format=hls')).toBe(false);
        expect(isAmbiguousStreamUrl('file:///tmp/video')).toBe(false);
        expect(isAmbiguousStreamUrl('https://example.invalid/play.php?session=1')).toBe(true);
        expect(isAmbiguousStreamUrl('https://example.invalid/play.php')).toBe(true);
    });

    it('recognizes only declared MIME types, without assuming PHP means TS', () => {
        expect(declaredAmbiguousStreamFormat('https://example.invalid/play.php',
            'application/vnd.apple.mpegurl; charset=utf-8')).toBe('hls');
        expect(declaredAmbiguousStreamFormat('https://example.invalid/play.php',
            'video/mp2t')).toBe('mpegts');
        expect(declaredAmbiguousStreamFormat('https://example.invalid/play.php',
            'text/html')).toBeNull();
    });

    it('uses one HEAD without body, credentials or leaking URL on failure', async () => {
        const oldFetch = globalThis.fetch;
        const mocked = jest.fn().mockResolvedValue({
            ok: true,
            url: 'https://example.invalid/live/stream.m3u8',
            headers: { get: () => 'application/octet-stream' },
        });
        globalThis.fetch = mocked as typeof fetch;
        try {
            expect(await probeAmbiguousStreamFormat('https://example.invalid/live.php')).toBe('hls');
            expect(mocked).toHaveBeenCalledTimes(1);
            expect(mocked.mock.calls[0][1]).toEqual(expect.objectContaining({
                method: 'HEAD',
                credentials: 'omit',
            }));
        } finally {
            globalThis.fetch = oldFetch;
        }
    });
});
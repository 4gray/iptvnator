import { TestBed } from '@angular/core/testing';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';

const STREAM_URL = 'http://portal.example:8080/live/ch1.ts';
const GATED_PLAYBACK = {
    streamUrl: STREAM_URL,
    title: 'Gated Channel',
    headers: {
        'User-Agent': 'MAG250',
        Referer: 'http://portal.example',
        Cookie: 'mac=00%3A1A%3A79%3A00%3A00%3A01; stb_lang=en_US',
        Authorization: 'Bearer TOKEN123',
    },
};

describe('ElectronStreamHeadersService', () => {
    let service: ElectronStreamHeadersService;
    let setUserAgent: jest.Mock;

    beforeEach(() => {
        setUserAgent = jest.fn().mockResolvedValue(true);
        (window as unknown as { electron?: unknown }).electron = {
            setUserAgent,
        };
        service = TestBed.inject(ElectronStreamHeadersService);
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('returns null without an Electron bridge (PWA)', () => {
        delete (window as unknown as { electron?: unknown }).electron;

        expect(service.apply(GATED_PLAYBACK)).toBeNull();
        expect(setUserAgent).not.toHaveBeenCalled();
    });

    it('extracts the full header set and scopes it to the stream URL', async () => {
        await expect(service.apply(GATED_PLAYBACK)).resolves.toBe(true);

        expect(setUserAgent).toHaveBeenCalledWith(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            {
                authorization: 'Bearer TOKEN123',
                cookie: 'mac=00%3A1A%3A79%3A00%3A00%3A01; stb_lang=en_US',
            }
        );
    });

    it('prefers explicit userAgent/referer fields over the headers map', async () => {
        await service.apply({
            ...GATED_PLAYBACK,
            userAgent: 'ExplicitAgent/1.0',
            referer: 'http://explicit.example',
        });

        expect(setUserAgent).toHaveBeenCalledWith(
            'ExplicitAgent/1.0',
            'http://explicit.example',
            STREAM_URL,
            expect.anything()
        );
    });

    it('omits the credentials object when the playback carries none', async () => {
        await service.apply({
            streamUrl: 'https://example.com/live/plain.m3u8',
            title: 'Plain Channel',
            userAgent: 'PlainAgent/1.0',
        });

        expect(setUserAgent).toHaveBeenCalledWith(
            'PlainAgent/1.0',
            undefined,
            'https://example.com/live/plain.m3u8',
            undefined
        );
    });

    it('reports a superseded apply as not current', async () => {
        const resolvers: Array<() => void> = [];
        setUserAgent.mockImplementation(
            () =>
                new Promise<boolean>((resolve) =>
                    resolvers.push(() => resolve(true))
                )
        );

        const first = service.apply(GATED_PLAYBACK);
        const second = service.apply({
            ...GATED_PLAYBACK,
            streamUrl: 'http://portal.example:8080/live/ch2.ts',
        });

        resolvers[0]();
        resolvers[1]();

        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(true);
    });

    it('clears the override only while the caller still owns the slot', async () => {
        await service.apply(GATED_PLAYBACK);
        setUserAgent.mockClear();

        // A stale consumer (e.g. a destroyed component) must not wipe the
        // override a newer playback configured.
        service.clear('http://portal.example:8080/other-stream.ts');
        expect(setUserAgent).not.toHaveBeenCalled();

        service.clear(STREAM_URL);
        expect(setUserAgent).toHaveBeenCalledWith(
            undefined,
            undefined,
            STREAM_URL
        );
    });

    it('does not clear twice for the same stream', async () => {
        await service.apply(GATED_PLAYBACK);
        service.clear(STREAM_URL);
        setUserAgent.mockClear();

        service.clear(STREAM_URL);
        expect(setUserAgent).not.toHaveBeenCalled();
    });

    it('resolves instead of throwing when the bridge rejects', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
            /* silence */
        });
        setUserAgent.mockRejectedValue(new Error('ipc down'));

        await expect(service.apply(GATED_PLAYBACK)).resolves.toBe(true);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

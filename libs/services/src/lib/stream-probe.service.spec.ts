import { Injector, runInInjectionContext } from '@angular/core';
import type { StreamProbeHeaders } from '@iptvnator/shared/interfaces';
import { StreamProbeService } from './stream-probe.service';

type ProbeFn = jest.Mock<
    Promise<{ status: number; url: string; latencyMs?: number }>,
    [string, ('GET' | 'HEAD')?, StreamProbeHeaders?]
>;

/**
 * jsdom owns `window`, so the bridge is attached to it rather than replacing
 * it — assigning over `globalThis.window` silently does nothing here.
 */
function withBridge(probeStreamUrl: ProbeFn | undefined) {
    const host = window as unknown as { electron?: unknown };
    if (probeStreamUrl) {
        host.electron = { probeStreamUrl };
    } else {
        delete host.electron;
    }
    const injector = Injector.create({ providers: [] });
    return runInInjectionContext(injector, () => new StreamProbeService());
}

function ok(status: number, latencyMs = 42): ProbeFn {
    return jest.fn().mockResolvedValue({ status, url: 'u', latencyMs });
}

describe('StreamProbeService', () => {
    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('reports unknown, not fail, without a bridge', async () => {
        const service = withBridge(undefined);

        expect(service.isAvailable).toBe(false);
        await expect(service.probe('http://x/y.mkv')).resolves.toEqual({
            status: 'unknown',
        });
    });

    it('maps a success status to ok with its latency', async () => {
        const probe = ok(200);
        const service = withBridge(probe);

        const result = await service.probe('http://x/y.mkv');

        expect(probe).toHaveBeenCalledWith('http://x/y.mkv', 'HEAD', undefined);
        expect(result).toEqual(
            expect.objectContaining({ status: 'ok', latencyMs: 42 })
        );
    });

    it('carries the playlist headers into both attempts', async () => {
        const headers = { userAgent: 'MyPlayer/2.0', referer: 'http://x/' };
        const probe = jest
            .fn()
            .mockResolvedValueOnce({ status: 405, url: 'http://x/y.mkv' })
            .mockResolvedValueOnce({ status: 200, url: 'http://x/y.mkv' });
        const service = withBridge(probe as ProbeFn);

        await service.probe('http://x/y.mkv', 'HEAD', headers);

        // The GET retry has to carry them too, or the fallback answers 403
        // for a stream the first attempt was merely not allowed to HEAD.
        expect(probe).toHaveBeenNthCalledWith(
            1,
            'http://x/y.mkv',
            'HEAD',
            headers
        );
        expect(probe).toHaveBeenNthCalledWith(
            2,
            'http://x/y.mkv',
            'GET',
            headers
        );
    });

    it('maps a refusal to fail', async () => {
        const service = withBridge(ok(403));

        await expect(service.probe('http://x/y.mkv')).resolves.toEqual(
            expect.objectContaining({ status: 'fail', httpStatus: 403 })
        );
    });

    it('maps status 0 to unknown — never to unavailable', async () => {
        // 0 covers a timeout and a policy rejection as well as a dead host, so
        // it means "could not check", not "the source is dead".
        const service = withBridge(ok(0));

        await expect(service.probe('http://x/y.mkv')).resolves.toEqual(
            expect.objectContaining({ status: 'unknown', httpStatus: 0 })
        );
    });

    it.each([405, 501])(
        'retries with a ranged GET when the server refuses HEAD with %i',
        async (status) => {
            // Plenty of stream servers reject HEAD yet serve the media over
            // GET; reporting those as unavailable would be a confident lie.
            const probe = jest
                .fn()
                .mockResolvedValueOnce({ status, url: 'u' })
                .mockResolvedValueOnce({ status: 206, url: 'u', latencyMs: 30 })
                .mockName('probeStreamUrl') as ProbeFn;
            const service = withBridge(probe);

            const result = await service.probe('http://x/y.mkv');

            expect(probe).toHaveBeenNthCalledWith(
                1,
                'http://x/y.mkv',
                'HEAD',
                undefined
            );
            expect(probe).toHaveBeenNthCalledWith(
                2,
                'http://x/y.mkv',
                'GET',
                undefined
            );
            expect(result.status).toBe('ok');
        }
    );

    it('does not retry a plain refusal', async () => {
        const probe = ok(403);
        const service = withBridge(probe);

        await service.probe('http://x/y.mkv');

        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('serves a repeat probe from cache', async () => {
        const probe = ok(200);
        const service = withBridge(probe);

        await service.probe('http://x/y.mkv');
        await service.probe('http://x/y.mkv');

        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent probes of the same url into one request', async () => {
        const probe = ok(200);
        const service = withBridge(probe);

        await Promise.all([
            service.probe('http://x/y.mkv'),
            service.probe('http://x/y.mkv'),
        ]);

        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('does not cache an unknown outcome', async () => {
        // Caching "could not measure" would keep a good source looking
        // unverified for the whole TTL.
        const probe = ok(0);
        const service = withBridge(probe);

        await service.probe('http://x/y.mkv');
        expect(service.peek('http://x/y.mkv')).toBeNull();
    });
});

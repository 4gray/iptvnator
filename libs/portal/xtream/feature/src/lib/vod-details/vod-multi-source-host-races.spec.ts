import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    VodSourceDiscoveryService,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import {
    SettingsStore,
    StreamProbeService,
    VodSourcePinService,
} from '@iptvnator/services';
import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

import {
    ALT_THREE,
    ALT_TWO,
    MOVIE_A,
    MOVIE_B,
    PROBE_OK,
    createDeferred,
    resolveWith,
    resolvedFor,
} from './vod-multi-source-host.fixtures';

describe('VodMultiSourceHostService — stale resolutions', () => {
    let service: VodMultiSourceHostService;

    const movie = signal<VodMultiSourceMovie | null>(null);
    const vodAutoFailover = signal(false);
    const startPlayback = jest.fn();
    const discovery = { isAvailable: true, discover: jest.fn() };
    const resolver = { resolve: jest.fn() };
    const pins = { get: jest.fn(), set: jest.fn(), clear: jest.fn() };
    const probes = { probe: jest.fn() };

    /** Runs pending root effects, then drains the work they started. */

    async function loadMovie(
        sources: VodSourceCandidate[],
        target: VodMultiSourceMovie = MOVIE_A
    ): Promise<void> {
        discovery.discover.mockResolvedValue({
            sources,
            matchKind: 'title-year',
        });
        await service.load(target);
    }

    function rowFor(sourceId: string) {
        return service.sources().find((source) => source.id === sourceId);
    }

    /** Two consecutive switches, so the "previous" side carries real audio. */

    beforeEach(() => {
        jest.resetAllMocks();
        movie.set(null);
        vodAutoFailover.set(false);
        discovery.isAvailable = true;
        discovery.discover.mockResolvedValue({
            sources: [],
            matchKind: 'title-year',
        });
        resolver.resolve.mockImplementation(resolveWith());
        pins.get.mockResolvedValue(null);
        pins.set.mockResolvedValue(true);
        pins.clear.mockResolvedValue(true);
        probes.probe.mockResolvedValue(PROBE_OK);

        TestBed.configureTestingModule({
            providers: [
                VodMultiSourceHostService,
                { provide: VodSourceDiscoveryService, useValue: discovery },
                { provide: VodSourceResolverService, useValue: resolver },
                { provide: VodSourcePinService, useValue: pins },
                { provide: StreamProbeService, useValue: probes },
                { provide: SettingsStore, useValue: { vodAutoFailover } },
            ],
        });

        service = TestBed.inject(VodMultiSourceHostService);
        TestBed.runInInjectionContext(() =>
            service.bind({ startPlayback, movie })
        );
    });

    it('drops a switch once the movie identity goes null mid-navigation', async () => {
        await loadMovie([ALT_TWO]);

        const slow = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve.mockReturnValueOnce(slow.promise);

        const pending = service.play(ALT_TWO.id);

        // Route navigation empties the identity BEFORE the next movie's load()
        // runs. Without invalidating the session here, the guard would still
        // pass and the old movie's source would start over the new page.
        movie.set(null);
        TestBed.tick();

        slow.resolve(resolvedFor(ALT_TWO, 0));
        await expect(pending).resolves.toBe(false);

        expect(startPlayback).not.toHaveBeenCalled();
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(false);
    });

    it('drops a slower switch that a newer selection already superseded', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);

        const slow = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve
            .mockReturnValueOnce(slow.promise)
            .mockImplementation(resolveWith());

        // User clicks ALT_TWO, then changes their mind and clicks
        // ALT_THREE before the first resolution comes back.
        const first = service.play(ALT_TWO.id);
        const second = await service.play(ALT_THREE.id);
        expect(second).toBe(true);

        slow.resolve(resolvedFor(ALT_TWO, 0));
        await expect(first).resolves.toBe(false);

        // The late arrival must not steal the active source back, nor
        // repoint Undo at itself.
        expect(rowFor(ALT_THREE.id)?.isActive).toBe(true);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(false);
        expect(startPlayback).toHaveBeenLastCalledWith(
            expect.objectContaining({
                streamUrl: expect.stringContaining(String(ALT_THREE.contentId)),
            })
        );
    });

    it('drops a switch whose movie was navigated away from', async () => {
        await loadMovie([ALT_TWO]);
        service.reportPosition(2538);

        const slow = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve.mockReturnValueOnce(slow.promise);

        const pending = service.play(ALT_TWO.id);

        // A different movie opens while the resolution is still in flight.
        await loadMovie([ALT_TWO], MOVIE_B);
        startPlayback.mockClear();

        slow.resolve(resolvedFor(ALT_TWO, 2538));
        await expect(pending).resolves.toBe(false);

        // The old film's source must not start inside the new session —
        // that would also restart it from the new session's zero position.
        expect(startPlayback).not.toHaveBeenCalled();
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(false);
    });

    it('keeps a switch alive when the same movie is rediscovered', async () => {
        await loadMovie([ALT_TWO]);

        const slow = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve.mockReturnValueOnce(slow.promise);

        const pending = service.play(ALT_TWO.id);

        // Enrichment lands mid-resolution and reruns discovery for the SAME
        // film. That is a refresh, not a navigation: cancelling here would
        // make the user's click do nothing at all.
        await loadMovie([ALT_TWO], { ...MOVIE_A, tmdbId: 603 });

        slow.resolve(resolvedFor(ALT_TWO, 0));
        await expect(pending).resolves.toBe(true);

        expect(startPlayback).toHaveBeenCalledTimes(1);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
    });

    it('drops a probe result whose movie was navigated away from', async () => {
        await loadMovie([ALT_TWO]);

        const slow = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve.mockReturnValueOnce(slow.promise);

        const pending = service.check(ALT_TWO.id);
        await loadMovie([ALT_TWO], MOVIE_B);

        slow.resolve(resolvedFor(ALT_TWO, undefined));
        await pending;

        // A stale probe must not attach itself to the new movie's row.
        expect(probes.probe).not.toHaveBeenCalled();
        expect(rowFor(ALT_TWO.id)?.probe.status).toBe('idle');
    });
});

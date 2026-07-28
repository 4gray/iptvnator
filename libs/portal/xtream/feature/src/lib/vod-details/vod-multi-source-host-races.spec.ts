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

    // Whatever is on screen; the pin path distinguishes it from selection.

    const playbackLive = signal(false);
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
            service.bind({ startPlayback, movie, playbackLive })
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

    it('waits for a discovery still in flight before giving up', async () => {
        const slow = createDeferred<{
            sources: VodSourceCandidate[];
            matchKind: string;
        }>();
        discovery.discover.mockReturnValueOnce(slow.promise);
        vodAutoFailover.set(true);

        const loading = service.load(MOVIE_A);
        while (discovery.discover.mock.calls.length === 0) {
            await Promise.resolve();
        }

        // The stream died faster than the database answered. Concluding
        // "nowhere to go" here would strand the user on the error screen with
        // alternatives landing a moment later and nothing left to retry them.
        const failingOver = service.failover();
        slow.resolve({ sources: [ALT_TWO], matchKind: 'title-year' });
        await loading;

        await expect(failingOver).resolves.not.toBeNull();
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
    });

    it('abandons a failover whose movie was left during the wait', async () => {
        const slow = createDeferred<{
            sources: VodSourceCandidate[];
            matchKind: string;
        }>();
        discovery.discover.mockReturnValueOnce(slow.promise);
        vodAutoFailover.set(true);

        const loadingA = service.load(MOVIE_A);
        // The pin lookup runs first now, so wait until A is genuinely inside
        // discovery before the failure arrives.
        while (discovery.discover.mock.calls.length === 0) {
            await Promise.resolve();
        }
        const failingOver = service.failover();

        // The user navigates while A's discovery is still out. Running against
        // whatever controller is current afterwards would answer A's playback
        // failure by starting one of B's alternatives.
        await loadMovie([ALT_TWO, ALT_THREE], MOVIE_B);
        startPlayback.mockClear();

        slow.resolve({ sources: [ALT_TWO], matchKind: 'title-year' });
        await loadingA;

        await expect(failingOver).resolves.toBeNull();
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('leaves the spinner on the row that is still resolving', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);

        const slowTwo = createDeferred<ReturnType<typeof resolvedFor>>();
        const slowThree = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve
            .mockReturnValueOnce(slowTwo.promise)
            .mockReturnValueOnce(slowThree.promise);

        const first = service.play(ALT_TWO.id);
        const second = service.play(ALT_THREE.id);
        expect(service.busySourceId()).toBe(ALT_THREE.id);

        slowTwo.resolve(resolvedFor(ALT_TWO, 0));
        await first;

        // The abandoned pick finishing must not take the spinner off the row
        // the user is actually waiting on.
        expect(service.busySourceId()).toBe(ALT_THREE.id);

        slowThree.resolve(resolvedFor(ALT_THREE, 0));
        await second;

        expect(service.busySourceId()).toBeNull();
    });

    it('abandons a pinned play whose movie was left during the lookup', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO]);

        const lookup = createDeferred<number | null>();
        let insideLookup = false;
        const playing = service.playPinnedSource(() => {
            insideLookup = true;
            return lookup.promise;
        });
        // Wait until the call is genuinely inside the position lookup —
        // stopping earlier would only re-prove the guard before it.
        while (!insideLookup) {
            await Promise.resolve();
        }

        // Reading that source's own resume position is a database round-trip,
        // and another movie can take the screen across it. Playing then would
        // hand THIS film's source id to the film now showing.
        await loadMovie([ALT_TWO, ALT_THREE], MOVIE_B);
        startPlayback.mockClear();

        lookup.resolve(3600);

        await expect(playing).resolves.toBe(false);
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('drops a switch the route’s own Play superseded', async () => {
        await loadMovie([ALT_TWO]);

        const slow = createDeferred<ReturnType<typeof resolvedFor>>();
        resolver.resolve.mockReturnValueOnce(slow.promise);
        const pending = service.play(ALT_TWO.id);

        // The user gave up waiting and pressed Play on the route's own stream.
        // The older resolution must not come back and replace it.
        service.markRouteSourceActive();
        startPlayback.mockClear();

        slow.resolve(resolvedFor(ALT_TWO, 0));
        await expect(pending).resolves.toBe(false);

        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('drops a pin change whose movie was navigated away from', async () => {
        const pinFor = (candidate: VodSourceCandidate) => ({
            matchKey: 'title:the matrix:1999',
            playlistId: candidate.playlistId,
            contentId: candidate.contentId,
            portalType: 'xtream',
        });

        pins.get.mockResolvedValue(pinFor(ALT_TWO));
        await loadMovie([ALT_TWO]);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);

        const slow = createDeferred<boolean>();
        pins.clear.mockReturnValueOnce(slow.promise);
        const pending = service.togglePin(ALT_TWO.id);

        // Another movie opens — with a pin of its own — before the clear
        // comes back.
        pins.get.mockResolvedValue(pinFor(ALT_THREE));
        await loadMovie([ALT_TWO, ALT_THREE], MOVIE_B);

        slow.resolve(true);
        await pending;

        // The late unpin belongs to the film the user left. Applying it here
        // would clear the pin this movie just loaded, and its Play action
        // would silently stop starting from the preferred source.
        expect(rowFor(ALT_THREE.id)?.isPinned).toBe(true);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(false);
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

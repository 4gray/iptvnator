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
    CURRENT_A_ID,
    MOVIE_A,
    MOVIE_B,
    PROBE_OK,
    createDeferred,
    resolveWith,
    type DiscoveryResult,
} from './vod-multi-source-host.fixtures';

/**
 * When a session starts, and when it merely refreshes.
 *
 * These two are one question: metadata enrichment reruns discovery for the
 * film already on screen, and getting that wrong either loses the session or
 * never rebuilds the pin keys.
 */
describe('VodMultiSourceHostService — session lifecycle', () => {
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
    async function flushEffects(): Promise<void> {
        for (let index = 0; index < 6; index += 1) {
            TestBed.tick();
            await Promise.resolve();
        }
    }

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

    it('discovers once per bound movie identity', async () => {
        movie.set(MOVIE_A);
        await flushEffects();

        expect(discovery.discover).toHaveBeenCalledTimes(1);
        expect(discovery.discover).toHaveBeenCalledWith({
            title: 'The Matrix',
            year: 1999,
            currentPlaylistId: 'playlist-1',
            keepContentId: null,
        });

        movie.set({ ...MOVIE_A });
        await flushEffects();
        expect(discovery.discover).toHaveBeenCalledTimes(1);

        movie.set(MOVIE_B);
        await flushEffects();
        expect(discovery.discover).toHaveBeenCalledTimes(2);
    });

    it('rediscovers the same movie once enrichment describes it better', async () => {
        movie.set(MOVIE_A);
        await flushEffects();

        // The year and TMDB id arrive with get_vod_info, after the catalog
        // title opened the page. Discovery has to run again — that is how a
        // yearless search gets its year and a `tmdb:` pin becomes findable.
        movie.set({ ...MOVIE_A, tmdbId: 603 });
        await flushEffects();

        expect(discovery.discover).toHaveBeenCalledTimes(2);
    });

    it('does not burn a source the user only selected', async () => {
        // One alternative, so the route copy is the ONLY fallback left and
        // the outcome cannot depend on how candidates are ranked.
        await loadMovie([ALT_TWO]);

        // Straight to the alternative from the picker: the route copy was
        // selected by discovery but never played, so it is still a fallback.
        await expect(service.play(ALT_TWO.id)).resolves.toBe(true);
        expect(rowFor(CURRENT_A_ID)?.isTried).toBe(false);

        vodAutoFailover.set(true);

        // Burning it at discovery made this failure report the options
        // exhausted while a healthy copy sat untouched.
        await expect(service.failover()).resolves.not.toBeNull();
        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(true);
    });

    it('keeps the playing source when enrichment reloads the same movie', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        // The route copy actually plays first, so its turn is genuinely spent.
        service.markRouteSourceActive();
        await expect(service.play(ALT_TWO.id)).resolves.toBe(true);
        service.reportPosition(2538);

        await loadMovie([ALT_TWO, ALT_THREE], { ...MOVIE_A, tmdbId: 603 });

        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(false);
        // The source it already left stays burned, so "each source at most
        // once" still holds across the refresh.
        expect(rowFor(CURRENT_A_ID)?.isTried).toBe(true);
        expect(service.previousSourceId()).toBe(CURRENT_A_ID);

        vodAutoFailover.set(true);
        await expect(service.failover()).resolves.not.toBeNull();

        expect(rowFor(ALT_THREE.id)?.isActive).toBe(true);
        // And the live position survived, so it does not restart the film.
        expect(resolver.resolve).toHaveBeenLastCalledWith(
            expect.objectContaining({ id: ALT_THREE.id }),
            { startTime: 2538 }
        );
    });

    it('keeps the playing row when the refined year rejects it', async () => {
        await loadMovie([ALT_TWO]);
        await expect(service.play(ALT_TWO.id)).resolves.toBe(true);

        // Enrichment supplies the release year, and the year gate now rejects
        // the copy the yearless search had admitted. Off the LIST is right —
        // it is a different film. Off the SCREEN is not: it is the one
        // streaming, and the caption must not name a playlist that is not.
        await loadMovie([], { ...MOVIE_A, year: 2021 });

        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(false);
    });

    it('resets the failover session when a new movie loads', async () => {
        await loadMovie([ALT_TWO]);
        vodAutoFailover.set(true);

        await expect(service.failover()).resolves.not.toBeNull();
        await expect(service.failover()).resolves.toBeNull();
        expect(service.previousSourceId()).toBe(CURRENT_A_ID);

        await loadMovie([ALT_TWO], MOVIE_B);

        expect(service.previousSourceId()).toBeNull();
        expect(service.lastSwitch()).toBeNull();
        await expect(service.failover()).resolves.not.toBeNull();
    });

    it('discards a discovery that resolves after the movie changed', async () => {
        const first = createDeferred<DiscoveryResult>();
        discovery.discover.mockReturnValueOnce(first.promise);

        const loadA = service.load(MOVIE_A);
        // A's pin lookup runs before its discovery, so wait for the call that
        // actually matters rather than guessing at microtask counts.
        while (discovery.discover.mock.calls.length === 0) {
            await Promise.resolve();
        }

        const loadB = loadMovie([ALT_THREE], MOVIE_B);
        first.resolve({ sources: [ALT_TWO], matchKind: 'title-year' });
        await loadA;
        await loadB;

        // A's alternatives must not appear anywhere in B's session.
        expect(service.sources().map((source) => source.id)).toEqual([
            'playlist-1:xtream:202',
            ALT_THREE.id,
        ]);
    });
});

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
    PROBE_OK,
    createDeferred,
    resolveWith,
} from './vod-multi-source-host.fixtures';

/**
 * "Make this the main source" as a persisted decision.
 *
 * A pin is not decoration: it decides where Play starts and outranks every
 * other signal in failover. So what the row shows has to be what the database
 * actually holds — under every alias the movie can be looked up by.
 */
describe('VodMultiSourceHostService — pinning', () => {
    let service: VodMultiSourceHostService;

    const movie = signal<VodMultiSourceMovie | null>(null);
    const vodAutoFailover = signal(false);
    const startPlayback = jest.fn();
    const discovery = { isAvailable: true, discover: jest.fn() };
    const resolver = { resolve: jest.fn() };
    const pins = { get: jest.fn(), set: jest.fn(), clear: jest.fn() };
    const probes = { probe: jest.fn() };

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
            service.bind({ startPlayback, movie })
        );
    });

    it('plays the pinned source instead of the route playlist', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO, ALT_THREE]);

        // Without this the persisted preference is only an icon: reopening the
        // movie would still start the playlist the route is on.
        await expect(service.playPinnedSource()).resolves.toBe(true);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
    });

    it('resumes the pinned source from the stored position', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO]);

        // What the route knows after loading playback positions. Nothing has
        // played yet, so no timeupdate has reported anything — and the button
        // the user is about to press says "Resume".
        service.seedResumePosition(2538);

        await expect(service.playPinnedSource()).resolves.toBe(true);

        expect(resolver.resolve).toHaveBeenCalledWith(
            expect.objectContaining({ id: ALT_TWO.id }),
            { startTime: 2538 }
        );
    });

    it('asks discovery to keep a copy pinned inside the current playlist', async () => {
        // The pin was set on another copy of the film in the playlist the user
        // is now opening. Excluding that playlist wholesale would leave the pin
        // pointing at a row that is not in the list, so Play would ignore it.
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: MOVIE_A.playlistId,
            contentId: 4242,
            portalType: 'xtream',
        });

        await loadMovie([]);

        expect(discovery.discover).toHaveBeenCalledWith(
            expect.objectContaining({
                currentPlaylistId: MOVIE_A.playlistId,
                keepContentId: 4242,
            })
        );
    });

    it('asks for no exception when the pin is in another playlist', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });

        await loadMovie([ALT_TWO]);

        expect(discovery.discover).toHaveBeenCalledWith(
            expect.objectContaining({ keepContentId: null })
        );
    });

    it('resumes a pinned alternative from its OWN stored position', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO]);

        // What the page loaded belongs to the ROUTE's copy — a different row
        // entirely from the one the user has been watching through the pin.
        service.seedResumePosition(12);

        const resumeFor = jest.fn().mockResolvedValue(3600);
        await expect(service.playPinnedSource(resumeFor)).resolves.toBe(true);

        expect(resumeFor).toHaveBeenCalledWith(
            expect.objectContaining({ id: ALT_TWO.id })
        );
        expect(resolver.resolve).toHaveBeenCalledWith(
            expect.objectContaining({ id: ALT_TWO.id }),
            { startTime: 3600 }
        );
    });

    it('keeps the page position when the pinned source has none', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO]);
        service.seedResumePosition(2538);

        await expect(
            service.playPinnedSource(jest.fn().mockResolvedValue(null))
        ).resolves.toBe(true);

        expect(resolver.resolve).toHaveBeenCalledWith(
            expect.objectContaining({ id: ALT_TWO.id }),
            { startTime: 2538 }
        );
    });

    it('hands the playing badge back when the route stream starts', async () => {
        await loadMovie([ALT_TWO]);
        await expect(service.play(ALT_TWO.id)).resolves.toBe(true);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);

        // The user closed that player and pressed Play. The route's own stream
        // is what runs now, so the picker and caption must not keep naming the
        // alternative as "Playing".
        service.markRouteSourceActive();

        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(true);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(false);
    });

    it('waits for the stored pin before letting Play fall through', async () => {
        const slow = createDeferred<{
            sources: VodSourceCandidate[];
            matchKind: string;
        }>();
        discovery.discover.mockReturnValueOnce(slow.promise);
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });

        const loading = service.load(MOVIE_A);

        // Play pressed while the lookup is still out. Answering "nothing is
        // pinned" here would start the route's own source and make a persisted
        // preference depend on worker latency.
        const playing = service.playPinnedSource();
        slow.resolve({ sources: [ALT_TWO], matchKind: 'title-year' });
        await loading;

        await expect(playing).resolves.toBe(true);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
    });

    it('leaves Play alone when nothing is pinned', async () => {
        await loadMovie([ALT_TWO]);

        await expect(service.playPinnedSource()).resolves.toBe(false);
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('prefers the pinned source when failing over', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_THREE.playlistId,
            contentId: ALT_THREE.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO, ALT_THREE]);
        vodAutoFailover.set(true);

        await expect(service.failover()).resolves.not.toBeNull();
        expect(rowFor(ALT_THREE.id)?.isActive).toBe(true);
    });

    it('round-trips a pin under the movie match key', async () => {
        await loadMovie([ALT_TWO]);
        const matchKeys: string[] = pins.get.mock.calls[0][0];
        expect(matchKeys.length).toBeGreaterThan(0);
        const pin = {
            matchKey: matchKeys[0],
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        };

        await service.togglePin(ALT_TWO.id);

        expect(pins.set).toHaveBeenCalledWith(pin);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);

        await service.togglePin(ALT_TWO.id);

        expect(pins.clear).toHaveBeenCalled();
        // Unpinning writes nothing further.
        expect(pins.set).toHaveBeenCalledTimes(1);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(false);

        pins.get.mockResolvedValue(pin);
        await loadMovie([ALT_TWO]);

        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);
        expect(rowFor(CURRENT_A_ID)?.isPinned).toBe(false);
    });
});

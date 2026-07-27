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
import type {
    VodSourceCandidate,
    VodSourceField,
} from '@iptvnator/shared/interfaces';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

import {
    ALT_THREE,
    ALT_TWO,
    API_AAC,
    API_AC3,
    CURRENT_A_ID,
    MOVIE_A,
    PARSED_DUB,
    PROBE_OK,
    resolveWith,
} from './vod-multi-source-host.fixtures';

describe('VodMultiSourceHostService', () => {
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

    function resolvedIds(): string[] {
        return resolver.resolve.mock.calls.map((call) => call[0].id);
    }

    /** Two consecutive switches, so the "previous" side carries real audio. */
    async function switchTwice(
        firstAudio: VodSourceField | undefined,
        secondAudio: VodSourceField
    ) {
        await loadMovie([ALT_TWO, ALT_THREE]);
        resolver.resolve.mockImplementation(
            resolveWith((candidate) =>
                candidate.id === ALT_TWO.id ? firstAudio : secondAudio
            )
        );

        await service.play(ALT_TWO.id);
        await service.play(ALT_THREE.id);

        return service.lastSwitch();
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

    it('counts only sources other than the playing one as alternatives', async () => {
        await loadMovie([]);

        expect(service.sources()).toHaveLength(1);
        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(true);
        expect(service.hasAlternatives()).toBe(false);
        expect(service.alternativeCount()).toBe(0);

        await loadMovie([ALT_TWO]);

        expect(service.sources()).toHaveLength(2);
        expect(service.hasAlternatives()).toBe(true);
        expect(service.alternativeCount()).toBe(1);
    });

    it('counts playlists, not copies, for the "found in N others" caption', async () => {
        // Two copies inside ONE other playlist. The popover groups them under
        // that single portal, so a caption reading "also found in 2 other
        // playlists" would contradict the list it invites the user to open.
        const secondCopy: VodSourceCandidate = {
            ...ALT_TWO,
            id: `${ALT_TWO.playlistId}:xtream:999`,
            contentId: 999,
        };
        await loadMovie([ALT_TWO, secondCopy]);

        expect(service.alternativeCount()).toBe(2);
        expect(service.alternativePlaylistCount()).toBe(1);

        await loadMovie([ALT_TWO, secondCopy, ALT_THREE]);
        expect(service.alternativePlaylistCount()).toBe(2);
    });

    it('carries the live timecode into the resolve call and the playback', async () => {
        await loadMovie([ALT_TWO]);
        service.reportPosition(2538);

        await expect(service.play(ALT_TWO.id)).resolves.toBe(true);

        expect(resolver.resolve).toHaveBeenCalledWith(
            expect.objectContaining({ id: ALT_TWO.id }),
            { startTime: 2538 }
        );
        expect(startPlayback).toHaveBeenCalledTimes(1);
        expect(startPlayback).toHaveBeenCalledWith(
            expect.objectContaining({ startTime: 2538 })
        );
    });

    it('announces every switch with the target playlist', async () => {
        await loadMovie([ALT_TWO]);
        service.reportPosition(2538);

        await service.play(ALT_TWO.id);

        expect(service.lastSwitch()).toEqual(
            expect.objectContaining({
                playlistName: ALT_TWO.playlistName,
                resumeSeconds: 2538,
            })
        );
        expect(service.previousSourceId()).toBe(CURRENT_A_ID);
    });

    it.each<[string, VodSourceField | undefined, VodSourceField, boolean]>([
        ['fires when both audio values are facts', API_AC3, API_AAC, true],
        ['is silent for a guessed audio', PARSED_DUB, API_AAC, false],
        ['is silent without both audio values', undefined, API_AAC, false],
    ])('the dub warning %s', async (_name, first, second, expected) => {
        expect(await switchTwice(first, second)).toEqual(
            expect.objectContaining({ audioMayDiffer: expected })
        );
    });

    it('does not fail over while auto-failover is off', async () => {
        await loadMovie([ALT_TWO]);
        resolver.resolve.mockClear();

        await expect(service.failover()).resolves.toBeNull();

        expect(resolver.resolve).not.toHaveBeenCalled();
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('fails over and announces it once auto-failover is enabled', async () => {
        await loadMovie([ALT_TWO]);
        vodAutoFailover.set(true);

        const notice = await service.failover();

        expect(notice).toEqual(
            expect.objectContaining({ playlistName: ALT_TWO.playlistName })
        );
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(true);
        expect(startPlayback).toHaveBeenCalledTimes(1);
    });

    it('never visits a source twice while failing over', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        vodAutoFailover.set(true);

        await expect(service.failover()).resolves.not.toBeNull();
        await expect(service.failover()).resolves.not.toBeNull();
        await expect(service.failover()).resolves.toBeNull();

        const visited = resolvedIds();
        expect(visited).toHaveLength(2);
        expect(new Set(visited).size).toBe(visited.length);
        expect(visited).not.toContain(CURRENT_A_ID);
        expect(service.isExhausted()).toBe(true);
    });

    it('keeps going when the best candidate cannot be resolved', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        vodAutoFailover.set(true);
        // Top-ranked source has a dead account: get_vod_info yields nothing.
        resolver.resolve.mockResolvedValueOnce(null);

        // Production calls failover() once, on the original failure — giving up
        // here would strand a perfectly healthy lower-ranked source.
        await expect(service.failover()).resolves.not.toBeNull();

        const [failedId, playingId] = resolvedIds();
        expect(playingId).not.toBe(failedId);
        expect(rowFor(failedId)?.isActive).toBe(false);
        expect(rowFor(failedId)?.isTried).toBe(true);
        expect(rowFor(playingId)?.isActive).toBe(true);
        expect(startPlayback).toHaveBeenCalledTimes(1);
    });

    it('gives up once every candidate fails to resolve', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        vodAutoFailover.set(true);
        resolver.resolve.mockResolvedValue(null);

        // Each attempt marks its source tried, so this terminates rather than
        // spinning through the same candidate forever.
        await expect(service.failover()).resolves.toBeNull();
        expect(startPlayback).not.toHaveBeenCalled();
        expect(service.isExhausted()).toBe(true);
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

        expect(pins.clear).toHaveBeenCalledWith(matchKeys);
        expect(pins.set).toHaveBeenCalledTimes(1);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(false);

        pins.get.mockResolvedValue(pin);
        await loadMovie([ALT_TWO]);

        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);
        expect(rowFor(CURRENT_A_ID)?.isPinned).toBe(false);
    });

    it('reports unknown, never fail, for a source it cannot check', async () => {
        await loadMovie([ALT_TWO]);
        resolver.resolve.mockResolvedValueOnce(null);

        await service.check(ALT_TWO.id);

        expect(rowFor(ALT_TWO.id)?.probe.status).toBe('unknown');
        expect(probes.probe).not.toHaveBeenCalled();

        await service.check(ALT_TWO.id);

        expect(probes.probe).toHaveBeenCalledWith(
            `http://${ALT_TWO.playlistId}/${ALT_TWO.contentId}.mkv`
        );
        expect(rowFor(ALT_TWO.id)?.probe).toEqual(PROBE_OK);
    });
});

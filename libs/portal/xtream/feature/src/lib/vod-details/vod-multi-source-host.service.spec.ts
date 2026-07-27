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
    ResolvedPortalPlayback,
    VodSourceCandidate,
    VodSourceField,
} from '@iptvnator/shared/interfaces';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

const MOVIE_A: VodMultiSourceMovie = {
    playlistId: 'playlist-1',
    playlistName: 'Playlist One',
    contentId: 101,
    title: 'The Matrix',
    year: 1999,
};
const MOVIE_B: VodMultiSourceMovie = {
    ...MOVIE_A,
    contentId: 202,
    title: 'Blade Runner',
    year: 1982,
}; // a second movie, to prove load() fully resets the session
const CURRENT_A_ID = 'playlist-1:xtream:101';

const API_AC3: VodSourceField = { value: 'ac3', provenance: 'api' };
const API_AAC: VodSourceField = { value: 'aac', provenance: 'api' };
const PARSED_DUB: VodSourceField = { value: 'Дубляж', provenance: 'parsed' };
const PROBE_OK = { status: 'ok', httpStatus: 200, latencyMs: 42 };

type DiscoveryResult = { sources: VodSourceCandidate[]; matchKind: string };
type AudioPicker = (c: VodSourceCandidate) => VodSourceField | undefined;

function alternative(index: number): VodSourceCandidate {
    return {
        id: `playlist-${index}:xtream:${900 + index}`,
        playlistId: `playlist-${index}`,
        playlistName: `Playlist ${index}`,
        portalType: 'xtream',
        contentId: 900 + index,
        rawTitle: 'The Matrix',
        matchConfidence: 'exact',
        year: 1999,
    };
}

const [ALT_TWO, ALT_THREE] = [alternative(2), alternative(3)];

function resolvedFor(
    candidate: VodSourceCandidate,
    startTime: number | undefined,
    audio?: VodSourceField
) {
    const playback: ResolvedPortalPlayback = {
        streamUrl: `http://${candidate.playlistId}/${candidate.contentId}.mkv`,
        title: candidate.rawTitle,
        isLive: false,
        startTime,
    };
    return { playback, candidate: { ...candidate, audio } };
}

/** Stands in for the resolver: echoes the start time, injects audio facts. */
function resolveWith(audioFor?: AudioPicker) {
    return async (
        candidate: VodSourceCandidate,
        options?: { startTime?: number }
    ) => resolvedFor(candidate, options?.startTime, audioFor?.(candidate));
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('VodMultiSourceHostService', () => {
    let service: VodMultiSourceHostService;

    const movie = signal<VodMultiSourceMovie | null>(null);
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

    it('discovers once per bound movie identity', async () => {
        movie.set(MOVIE_A);
        await flushEffects();

        expect(discovery.discover).toHaveBeenCalledTimes(1);
        expect(discovery.discover).toHaveBeenCalledWith({
            title: 'The Matrix',
            year: 1999,
            currentPlaylistId: 'playlist-1',
        });

        movie.set({ ...MOVIE_A });
        await flushEffects();
        expect(discovery.discover).toHaveBeenCalledTimes(1);

        movie.set(MOVIE_B);
        await flushEffects();
        expect(discovery.discover).toHaveBeenCalledTimes(2);
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

    it('does not retry a source it could not resolve', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        vodAutoFailover.set(true);
        resolver.resolve.mockResolvedValueOnce(null);

        await expect(service.failover()).resolves.toBeNull();

        const failedId = resolvedIds()[0];
        expect(rowFor(failedId)?.isActive).toBe(false);
        expect(rowFor(failedId)?.isTried).toBe(true);
        expect(startPlayback).not.toHaveBeenCalled();

        await expect(service.failover()).resolves.not.toBeNull();

        expect(resolvedIds()[1]).not.toBe(failedId);
        expect(rowFor(resolvedIds()[1])?.isActive).toBe(true);
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

    it('discards a discovery that resolves after the movie changed', async () => {
        const first = createDeferred<DiscoveryResult>();
        const second = createDeferred<DiscoveryResult>();
        discovery.discover
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const loadA = service.load(MOVIE_A);
        const loadB = service.load(MOVIE_B);

        first.resolve({ sources: [ALT_TWO], matchKind: 'title-year' });
        await loadA;

        expect(service.sources()).toEqual([]);
        // Abandoned on arrival: it never even looks the stale pin up.
        expect(pins.get).not.toHaveBeenCalled();

        second.resolve({ sources: [ALT_THREE], matchKind: 'title-year' });
        await loadB;

        expect(pins.get).toHaveBeenCalledTimes(1);
        expect(service.sources().map((source) => source.id)).toEqual([
            'playlist-1:xtream:202',
            ALT_THREE.id,
        ]);
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
});

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
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
/**
 * Shared fixtures for the multi-source host specs, extracted so the
 * race-condition suite can live in its own file rather than duplicating setup.
 */
import type {
    ResolvedPortalPlayback,
    VodSourceCandidate,
    VodSourceField,
} from '@iptvnator/shared/interfaces';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

export const MOVIE_A: VodMultiSourceMovie = {
    playlistId: 'playlist-1',
    playlistName: 'Playlist One',
    contentId: 101,
    title: 'The Matrix',
    year: 1999,
};
export const MOVIE_B: VodMultiSourceMovie = {
    ...MOVIE_A,
    contentId: 202,
    title: 'Blade Runner',
    year: 1982,
}; // a second movie, to prove load() fully resets the session
export const CURRENT_A_ID = 'playlist-1:xtream:101';

export const API_AC3: VodSourceField = { value: 'ac3', provenance: 'api' };
export const API_AAC: VodSourceField = { value: 'aac', provenance: 'api' };
export const PARSED_DUB: VodSourceField = {
    value: 'Дубляж',
    provenance: 'parsed',
};
export const API_LANG_RUS: VodSourceField = {
    value: 'rus',
    provenance: 'api',
};
export const API_LANG_ENG: VodSourceField = {
    value: 'eng',
    provenance: 'api',
};
export const PROBE_OK = { status: 'ok', httpStatus: 200, latencyMs: 42 };

export type DiscoveryResult = {
    sources: VodSourceCandidate[];
    matchKind: string;
};
/**
 * What a resolve should state about the audio.
 *
 * Two fields, because they answer different questions: `audio` is the codec
 * (or a guessed dub marker) and is display-only, while `audioLanguage` is the
 * one thing allowed to drive the "dub may differ" warning.
 */
export type AudioFacts = Pick<VodSourceCandidate, 'audio' | 'audioLanguage'>;
export type AudioPicker = (c: VodSourceCandidate) => Partial<AudioFacts>;

export function alternative(index: number): VodSourceCandidate {
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

export const [ALT_TWO, ALT_THREE] = [alternative(2), alternative(3)];

export function resolvedFor(
    candidate: VodSourceCandidate,
    startTime: number | undefined,
    audio?: Partial<AudioFacts>
) {
    const playback: ResolvedPortalPlayback = {
        streamUrl: `http://${candidate.playlistId}/${candidate.contentId}.mkv`,
        title: candidate.rawTitle,
        isLive: false,
        startTime,
    };
    return { playback, candidate: { ...candidate, ...audio } };
}

/** Stands in for the resolver: echoes the start time, injects audio facts. */
export function resolveWith(audioFor?: AudioPicker) {
    return async (
        candidate: VodSourceCandidate,
        options?: { startTime?: number }
    ) => resolvedFor(candidate, options?.startTime, audioFor?.(candidate));
}

export function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

/**
 * The TestBed every host spec needs.
 *
 * Five specs carried their own identical copy of this — the same five stubs,
 * the same reset, the same bind. One harness so they cannot drift, and so a
 * new case does not cost sixty lines of setup.
 */
export function setupVodMultiSourceHost() {
    const movie = signal<VodMultiSourceMovie | null>(null);
    /** Whatever is on screen; the pin path distinguishes it from selection. */
    const playbackLive = signal(false);
    const playbackStartBlocked = signal(false);
    const vodAutoFailover = signal(false);
    const startPlayback = jest.fn();
    const discovery = { isAvailable: true, discover: jest.fn() };
    const resolver = { resolve: jest.fn() };
    const pins = { get: jest.fn(), set: jest.fn(), clear: jest.fn() };
    const probes = { probe: jest.fn() };

    const harness = {
        movie,
        playbackLive,
        playbackStartBlocked,
        vodAutoFailover,
        startPlayback,
        discovery,
        resolver,
        pins,
        probes,
        service: null as unknown as VodMultiSourceHostService,

        /** Call from `beforeEach`; returns the freshly bound service. */
        reset(): VodMultiSourceHostService {
            jest.resetAllMocks();
            startPlayback.mockResolvedValue(true);
            movie.set(null);
            playbackLive.set(false);
            playbackStartBlocked.set(false);
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

            harness.service = TestBed.inject(VodMultiSourceHostService);
            TestBed.runInInjectionContext(() =>
                harness.service.bind({
                    startPlayback,
                    movie,
                    playbackLive,
                    playbackStartBlocked,
                })
            );
            return harness.service;
        },

        async loadMovie(
            sources: VodSourceCandidate[],
            target: VodMultiSourceMovie = MOVIE_A
        ): Promise<void> {
            discovery.discover.mockResolvedValue({
                sources,
                matchKind: 'title-year',
            });
            await harness.service.load(target);
        },

        rowFor(sourceId: string) {
            return harness.service
                .sources()
                .find((source) => source.id === sourceId);
        },
    };

    return harness;
}

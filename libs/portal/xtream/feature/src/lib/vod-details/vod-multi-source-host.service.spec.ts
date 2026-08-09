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
    API_AAC,
    API_AC3,
    API_LANG_ENG,
    API_LANG_RUS,
    CURRENT_A_ID,
    MOVIE_A,
    MOVIE_B,
    PARSED_DUB,
    PROBE_OK,
    alternative,
    createDeferred,
    resolveWith,
    type AudioFacts,
    type DiscoveryResult,
} from './vod-multi-source-host.fixtures';

describe('VodMultiSourceHostService', () => {
    let service: VodMultiSourceHostService;

    const movie = signal<VodMultiSourceMovie | null>(null);

    // Whatever is on screen; the pin path distinguishes it from selection.

    const playbackLive = signal(false);
    const playbackStartBlocked = signal(false);
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
        first: Partial<AudioFacts> | undefined,
        second: Partial<AudioFacts>
    ) {
        await loadMovie([ALT_TWO, ALT_THREE]);
        resolver.resolve.mockImplementation(
            resolveWith((candidate) =>
                candidate.id === ALT_TWO.id ? (first ?? {}) : second
            )
        );

        await service.play(ALT_TWO.id);
        await service.play(ALT_THREE.id);

        return service.lastSwitch();
    }

    beforeEach(() => {
        jest.resetAllMocks();
        startPlayback.mockResolvedValue(true);
        movie.set(null);
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

        service = TestBed.inject(VodMultiSourceHostService);
        TestBed.runInInjectionContext(() =>
            service.bind({
                startPlayback,
                movie,
                playbackLive,
                playbackStartBlocked,
            })
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
            expect.objectContaining({ startTime: 2538 }),
            expect.any(Function)
        );
    });

    it('keeps the current source when playback rejects the handoff', async () => {
        await loadMovie([ALT_TWO]);
        startPlayback.mockResolvedValueOnce(false);

        await expect(service.play(ALT_TWO.id)).resolves.toBe(false);

        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(true);
        expect(rowFor(ALT_TWO.id)?.isActive).toBe(false);
        expect(service.lastSwitch()).toBeNull();
        expect(service.previousSourceId()).toBeNull();
    });

    it('does not launch a resolved source after a newer unresolvable pick', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        const teardown = createDeferred<void>();
        const launched: string[] = [];
        startPlayback.mockImplementationOnce(
            async (
                playback: { streamUrl: string },
                isCurrent?: () => boolean
            ) => {
                await teardown.promise;
                if (isCurrent && !isCurrent()) {
                    return false;
                }
                launched.push(playback.streamUrl);
                return true;
            }
        );

        const first = service.play(ALT_TWO.id);
        while (startPlayback.mock.calls.length === 0) {
            await Promise.resolve();
        }

        resolver.resolve.mockResolvedValueOnce(null);
        await expect(service.play(ALT_THREE.id)).resolves.toBe(false);

        teardown.resolve();
        await expect(first).resolves.toBe(false);

        expect(launched).toEqual([]);
        expect(rowFor(CURRENT_A_ID)?.isActive).toBe(true);
        expect(service.lastSwitch()).toBeNull();
    });

    it('never puts a credential-bearing playlist name in the notice', async () => {
        // Users routinely name a playlist after the URL they pasted, and this
        // string goes straight into a toast over the video.
        const leaky = {
            ...ALT_TWO,
            playlistName:
                'http://portal.example.com:8080/get.php?username=alice&password=hunter2',
        };
        await loadMovie([leaky]);

        await service.play(leaky.id);

        const notice = service.lastSwitch();
        expect(notice?.playlistName).not.toContain('hunter2');
        expect(notice?.playlistName).not.toContain('alice');
        expect(notice?.playlistName).toBe('portal.example.com:8080');
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

    it.each<
        [string, Partial<AudioFacts> | undefined, Partial<AudioFacts>, boolean]
    >([
        [
            'fires when both sides state a different language',
            { audioLanguage: API_LANG_RUS },
            { audioLanguage: API_LANG_ENG },
            true,
        ],
        [
            'is silent when the language is the same',
            { audioLanguage: API_LANG_RUS },
            { audioLanguage: API_LANG_RUS },
            false,
        ],
        [
            // A codec is not a dub: AAC and AC3 routinely carry the same one,
            // so this fired on every identical-language re-encode.
            'is silent for a codec change alone',
            { audio: API_AC3 },
            { audio: API_AAC },
            false,
        ],
        [
            'is silent for a guessed dub marker',
            { audioLanguage: PARSED_DUB },
            { audioLanguage: API_LANG_ENG },
            false,
        ],
        [
            'is silent without both languages',
            undefined,
            { audioLanguage: API_LANG_ENG },
            false,
        ],
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
    });

    it('abandons a waiting failover once the user starts something else', async () => {
        await loadMovie([ALT_TWO, ALT_THREE]);
        vodAutoFailover.set(true);

        // A same-movie rediscovery is still out when the stream fails.
        const slow = createDeferred<DiscoveryResult>();
        discovery.discover.mockReturnValueOnce(slow.promise);
        const reloading = service.load({ ...MOVIE_A, tmdbId: 603 });
        while (discovery.discover.mock.calls.length < 2) {
            await Promise.resolve();
        }
        const failingOver = service.failover();

        // Across that wait the user restarts the route's own stream. The
        // session is unchanged — it only moves when the FILM does — so
        // checking it alone lets failover treat what they just started as the
        // thing that failed and switch away from it.
        service.markRouteSourceActive();

        slow.resolve({
            sources: [ALT_TWO, ALT_THREE],
            matchKind: 'title-year',
        });
        await reloading;

        await expect(failingOver).resolves.toBeNull();
        expect(startPlayback).not.toHaveBeenCalled();
    });

    it('reports unknown, never fail, for a source it cannot check', async () => {
        await loadMovie([ALT_TWO]);
        resolver.resolve.mockResolvedValueOnce(null);

        await service.check(ALT_TWO.id);

        expect(rowFor(ALT_TWO.id)?.probe.status).toBe('unknown');
        expect(probes.probe).not.toHaveBeenCalled();

        await service.check(ALT_TWO.id);

        // Probed with the playlist's own playback headers, or a panel that
        // requires them answers 403 and a working source looks dead.
        expect(probes.probe).toHaveBeenCalledWith(
            `http://${ALT_TWO.playlistId}/${ALT_TWO.contentId}.mkv`,
            'HEAD',
            expect.objectContaining({ userAgent: undefined })
        );
        expect(rowFor(ALT_TWO.id)?.probe).toEqual(PROBE_OK);
    });

    it('marks a row checking immediately and refuses to enqueue it twice', async () => {
        await loadMovie([ALT_TWO]);
        const gate = createDeferred<null>();
        resolver.resolve.mockReturnValue(gate.promise);

        const first = service.check(ALT_TWO.id);
        expect(rowFor(ALT_TWO.id)?.probe.status).toBe('probing');

        // A second click on the same spinner must not queue a second probe.
        const second = service.check(ALT_TWO.id);
        gate.resolve(null);
        await Promise.all([first, second]);

        expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it('runs at most four checks at once; the rest wait their turn', async () => {
        const alts = [2, 3, 4, 5, 6].map(alternative);
        await loadMovie(alts);

        const gates = new Map<string, ReturnType<typeof createDeferred>>();
        resolver.resolve.mockImplementation((candidate) => {
            const gate = createDeferred<null>();
            gates.set((candidate as VodSourceCandidate).id, gate);
            return gate.promise;
        });

        const pending = alts.map((alt) => service.check(alt.id));
        await new Promise((resolve) => setTimeout(resolve));

        // Every row spins from the moment it was asked for...
        for (const alt of alts) {
            expect(rowFor(alt.id)?.probe.status).toBe('probing');
        }
        // ...but only four have actually started resolving.
        expect(resolver.resolve).toHaveBeenCalledTimes(4);

        gates.get(alts[0].id)?.resolve(null);
        await new Promise((resolve) => setTimeout(resolve));
        expect(resolver.resolve).toHaveBeenCalledTimes(5);

        for (const [, gate] of gates) {
            gate.resolve(null);
        }
        await Promise.all(pending);
    });

    it('drops queued checks once the user opens another movie', async () => {
        const alts = [2, 3, 4, 5, 6, 7].map(alternative);
        await loadMovie(alts);

        const gates = new Map<string, ReturnType<typeof createDeferred>>();
        resolver.resolve.mockImplementation((candidate) => {
            const gate = createDeferred<null>();
            gates.set((candidate as VodSourceCandidate).id, gate);
            return gate.promise;
        });

        const pending = alts.map((alt) => service.check(alt.id));
        await new Promise((resolve) => setTimeout(resolve));
        // Four in flight, two still waiting for a slot.
        expect(resolver.resolve).toHaveBeenCalledTimes(4);

        // The user navigates away while those two are still queued. They are
        // about a film that is no longer on screen, so they must not spend a
        // resolve against a foreign portal when a slot frees up.
        await loadMovie([], MOVIE_B);

        for (const [, gate] of gates) {
            gate.resolve(null);
        }
        await Promise.all(pending);

        expect(resolver.resolve).toHaveBeenCalledTimes(4);
    });

    it('remembers verdicts across sessions instead of re-checking', async () => {
        probes.probe.mockResolvedValue({
            ...PROBE_OK,
            probedAt: new Date().toISOString(),
        });
        await loadMovie([ALT_TWO]);
        await service.check(ALT_TWO.id);
        expect(rowFor(ALT_TWO.id)?.probe.status).toBe('ok');

        // Another film resets the controller and its probe states entirely.
        await loadMovie([], MOVIE_B);
        expect(rowFor(ALT_TWO.id)).toBeUndefined();

        // Returning to the movie finds the verdict remembered: the row shows
        // "available" again without a single new request.
        resolver.resolve.mockClear();
        probes.probe.mockClear();
        await loadMovie([ALT_TWO], MOVIE_A);

        expect(rowFor(ALT_TWO.id)?.probe.status).toBe('ok');
        expect(resolver.resolve).not.toHaveBeenCalled();
        expect(probes.probe).not.toHaveBeenCalled();
    });
});

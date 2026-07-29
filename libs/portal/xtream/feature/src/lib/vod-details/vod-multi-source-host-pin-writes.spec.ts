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
} from './vod-multi-source-host.fixtures';

/**
 * What the database ends up holding.
 *
 * The row on screen is a promise that the preference survives reopening the
 * movie, so a write that did not land must not be shown as one — and the
 * aliases a movie can be looked up by are not all safe to write to or delete.
 */
describe('VodMultiSourceHostService — pin persistence', () => {
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

    it('lets a pin made during a rediscovery win over the old one', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO, ALT_THREE]);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);

        // Enrichment reruns discovery for the same film...
        const slow = createDeferred<{
            sources: VodSourceCandidate[];
            matchKind: string;
        }>();
        discovery.discover.mockReturnValueOnce(slow.promise);
        const reloading = service.load({ ...MOVIE_A, tmdbId: 603 });
        while (discovery.discover.mock.calls.length < 2) {
            await Promise.resolve();
        }

        // ...and the user pins a different source while it is still out.
        await service.togglePin(ALT_THREE.id);

        slow.resolve({
            sources: [ALT_TWO, ALT_THREE],
            matchKind: 'title-year',
        });
        await reloading;

        // The snapshot that rerun started with is now stale. Restoring it
        // would leave the row and Play on a source the database no longer
        // holds.
        expect(rowFor(ALT_THREE.id)?.isPinned).toBe(true);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(false);
    });

    it('stores itself under its own keys, never under a remake’s', async () => {
        // With a TMDB id there are two keys naming this film and one shared
        // with every remake, so both lists are worth asserting on.
        await loadMovie([ALT_TWO], { ...MOVIE_A, tmdbId: 603 });
        expect(pins.get.mock.calls[0][0]).toEqual([
            'tmdb:603',
            'title:the matrix:1999',
            'title:the matrix:',
        ]);

        await service.togglePin(ALT_TWO.id);

        expect(pins.set).toHaveBeenCalledWith(
            expect.objectContaining({ matchKey: 'tmdb:603' }),
            expect.any(Array),
            expect.any(Array)
        );
        // Both lists ride along with the write, so none of it can half-apply.
        const [, retired, aliases] = pins.set.mock.calls[0] as [
            unknown,
            string[],
            string[],
        ];
        // This film's pre-enrichment key takes the SAME decision instead of
        // being deleted: a reopen that has only a title and a year still finds
        // the pin, and finds this source rather than the one just replaced.
        expect(aliases).toContain('title:the matrix:1999');
        expect(retired).not.toContain('title:the matrix:1999');
        // The yearless form is shared by every remake: a Dune (2021) pin must
        // not answer for — or delete — a row that may be Dune (1984)'s.
        expect(aliases).not.toContain('title:the matrix:');
        expect(retired).not.toContain('title:the matrix:');
        // And never the row just written.
        expect(retired).not.toContain('tmdb:603');
    });

    it('survives a reopen that has not been enriched yet', async () => {
        // The whole point of the pin is that it outlives the page. Enrichment
        // is asynchronous and optional, so the movie that owned a `tmdb:` key
        // when the user pinned it opens again as nothing but a title and a
        // year — and asks for the pin under THAT identity.
        const rows = new Map<string, unknown>();
        pins.set.mockImplementation(
            async (
                pin: { matchKey: string },
                retire: string[] = [],
                aliases: string[] = []
            ) => {
                for (const key of [pin.matchKey, ...aliases]) {
                    rows.set(key, { ...pin, matchKey: key });
                }
                for (const key of retire) {
                    rows.delete(key);
                }
                return true;
            }
        );
        pins.get.mockImplementation(async (keys: string[]) => {
            for (const key of keys) {
                if (rows.has(key)) {
                    return rows.get(key);
                }
            }
            return null;
        });

        await loadMovie([ALT_TWO, ALT_THREE], { ...MOVIE_A, tmdbId: 603 });
        await service.togglePin(ALT_THREE.id);
        expect(rowFor(ALT_THREE.id)?.isPinned).toBe(true);

        // Away to another film and back. That is what makes this a REOPEN:
        // the session key is (playlist, content), so a different movie is what
        // drops the in-memory controller and forces the pin to be re-read from
        // storage — the same thing reopening the page does.
        await loadMovie([], MOVIE_B);
        await loadMovie([ALT_TWO, ALT_THREE], MOVIE_A);

        // MOVIE_A carries no TMDB id, so this lookup asks only for the title
        // forms. Stored under the enriched key alone the preference would be
        // invisible here, and Play would quietly start the route source.
        expect(pins.get).toHaveBeenLastCalledWith([
            'title:the matrix:1999',
            'title:the matrix:',
        ]);
        expect(rowFor(ALT_THREE.id)?.isPinned).toBe(true);
    });

    it('keeps the stored pin when the replacement write fails', async () => {
        await loadMovie([ALT_TWO], { ...MOVIE_A, tmdbId: 603 });
        pins.set.mockResolvedValue(false);

        await service.togglePin(ALT_TWO.id);

        // One transaction: a refused write retires nothing either.
        expect(pins.clear).not.toHaveBeenCalled();
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(false);
    });

    it('retires the ambiguous row it actually read', async () => {
        // A pin set before the year was known lives under the yearless key.
        // This session read it, so the user is unpinning THAT row — leaving it
        // would make the unpin come back on the next open.
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO]);

        await service.togglePin(ALT_TWO.id);

        const [retired] = pins.clear.mock.calls[0] as [string[]];
        expect(retired).toContain('title:the matrix:');
    });

    it('does not show a pin the database refused to store', async () => {
        await loadMovie([ALT_TWO]);
        pins.set.mockResolvedValue(false);

        await service.togglePin(ALT_TWO.id);

        // The icon promises the preference survives reopening the movie. A
        // write that failed makes that a lie, so the row must not change.
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(false);
    });

    it('retires the aliases in the same call that writes the pin', async () => {
        await loadMovie([ALT_TWO], { ...MOVIE_A, tmdbId: 603 });

        await service.togglePin(ALT_TWO.id);

        // Previously a write followed by a clear: if the clear failed, the
        // surviving alias was read BEFORE the canonical key on the next open
        // and started the source the user had just replaced. Neither
        // half-outcome had an honest answer, so there is only one call now.
        expect(pins.set).toHaveBeenCalledTimes(1);
        expect(pins.clear).not.toHaveBeenCalled();
        const [, , aliases] = pins.set.mock.calls[0] as [
            unknown,
            string[],
            string[],
        ];
        expect(aliases).toContain('title:the matrix:1999');
    });

    it('keeps the pin when clearing it fails', async () => {
        pins.get.mockResolvedValue({
            matchKey: 'title:the matrix:1999',
            playlistId: ALT_TWO.playlistId,
            contentId: ALT_TWO.contentId,
            portalType: 'xtream',
        });
        await loadMovie([ALT_TWO]);
        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);

        pins.clear.mockResolvedValue(false);
        await service.togglePin(ALT_TWO.id);

        expect(rowFor(ALT_TWO.id)?.isPinned).toBe(true);
    });
});

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

    it('retires its own aliases but never another remake’s', async () => {
        // With a TMDB id there are two keys naming this film and one shared
        // with every remake, so the retire set is worth asserting on.
        await loadMovie([ALT_TWO], { ...MOVIE_A, tmdbId: 603 });
        expect(pins.get.mock.calls[0][0]).toEqual([
            'tmdb:603',
            'title:the matrix:1999',
            'title:the matrix:',
        ]);

        await service.togglePin(ALT_TWO.id);

        expect(pins.set).toHaveBeenCalledWith(
            expect.objectContaining({ matchKey: 'tmdb:603' })
        );
        const [retired] = pins.clear.mock.calls[0] as [string[]];
        // This film's other key goes, so a reopen before enrichment cannot
        // read a row still pointing at the source just replaced.
        expect(retired).toContain('title:the matrix:1999');
        // The yearless form is shared by every remake: a Dune (2021) pin must
        // not delete — or answer for — a row that may be Dune (1984)'s.
        expect(retired).not.toContain('title:the matrix:');
        // And never the row just written.
        expect(retired).not.toContain('tmdb:603');
    });

    it('keeps the stored pin when the replacement write fails', async () => {
        await loadMovie([ALT_TWO], { ...MOVIE_A, tmdbId: 603 });
        pins.set.mockResolvedValue(false);

        await service.togglePin(ALT_TWO.id);

        // Retiring first would destroy the stored preference and then fail to
        // replace it: nothing persisted, while the row still shows the old pin.
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

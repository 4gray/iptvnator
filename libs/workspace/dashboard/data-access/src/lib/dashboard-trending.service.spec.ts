import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import type { TmdbTrendingEntry } from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { DashboardDataService } from './dashboard-data.service';
import { DashboardTrendingService } from './dashboard-trending.service';

describe('DashboardTrendingService', () => {
    // The parental lock's view of each match's category, as a signal so a
    // relock re-runs the services' computed filters.
    const withheldCategories = signal(new Set<number>());
    const isWithheld = (match: CatalogTitleMatch) =>
        withheldCategories().has(match.categoryId);

    const entry = (
        overrides: Partial<TmdbTrendingEntry> = {}
    ): TmdbTrendingEntry => ({
        tmdbId: 603,
        mediaType: 'movie',
        title: 'The Matrix',
        year: 1999,
        posterUrl: null,
        rating: '8.2',
        popularity: 100,
        ...overrides,
    });

    const match = (
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle: 'The Matrix',
        playlistId: 'pl-1',
        playlistName: 'My Portal',
        categoryId: 7,
        xtreamId: 42,
        type: 'movie',
        trailingYear: null,
        ...overrides,
    });

    let getTrendingWeek: jest.Mock;
    let matchTitles: jest.Mock;
    let isEnabled: jest.Mock;
    let language: string;
    const playlists = signal<{ _id: string }[]>([{ _id: 'pl-1' }]);

    function createService(
        options: { matchingAvailable?: boolean } = {}
    ): DashboardTrendingService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled,
                        getTrendingWeek,
                        language: () => language,
                    },
                },
                { provide: DashboardDataService, useValue: { playlists } },
                {
                    provide: CatalogTitleMatchService,
                    useValue: {
                        isAvailable: options.matchingAvailable ?? true,
                        matchTitles,
                        isWithheld,
                        visibleMatches: (matches: CatalogTitleMatch[]) =>
                            matches.filter((m) => !isWithheld(m)),
                    },
                },
            ],
        });
        return TestBed.inject(DashboardTrendingService);
    }

    beforeEach(() => {
        withheldCategories.set(new Set());
        language = 'en';
        playlists.set([{ _id: 'pl-1' }]);
        isEnabled = jest.fn().mockReturnValue(true);
        getTrendingWeek = jest.fn().mockResolvedValue([entry()]);
        matchTitles = jest.fn().mockResolvedValue([match()]);
    });

    it('does nothing when TMDB is disabled', async () => {
        isEnabled.mockReturnValue(false);
        const service = createService();

        await service.load();

        expect(getTrendingWeek).not.toHaveBeenCalled();
        expect(service.items()).toEqual([]);
    });

    it('does nothing without the Electron title matcher (PWA)', async () => {
        const service = createService({ matchingAvailable: false });

        await service.load();

        expect(getTrendingWeek).not.toHaveBeenCalled();
    });

    it('attaches library matches to trending entries', async () => {
        const service = createService();

        await service.load();

        expect(service.items()).toHaveLength(1);
        expect(service.items()[0].match?.playlistName).toBe('My Portal');
        expect(service.loading()).toBe(false);
    });

    it('drops the library match of a category the lock withholds, on read', async () => {
        const service = createService();
        await service.load();
        expect(service.items()[0].match).not.toBeNull();

        // Lock now: the cached match must stop advertising the title.
        withheldCategories.set(new Set([7]));
        expect(service.items()).toHaveLength(1);
        expect(service.items()[0].match).toBeNull();

        withheldCategories.set(new Set());
        expect(service.items()[0].match?.playlistName).toBe('My Portal');
    });

    it('falls back to a copy in an unlocked portal when the chosen match is withheld', async () => {
        playlists.set([{ _id: 'pl-1' }, { _id: 'pl-2' }]);
        matchTitles.mockResolvedValue([
            match(),
            match({ playlistId: 'pl-2', playlistName: 'Other', categoryId: 8 }),
        ]);
        const service = createService();
        await service.load();
        expect(service.items()[0].match?.playlistId).toBe('pl-1');

        withheldCategories.set(new Set([7]));
        expect(service.items()[0].match?.playlistName).toBe('Other');
    });

    it('rejects year-incompatible base-tier matches', async () => {
        getTrendingWeek.mockResolvedValue([
            entry({ title: 'Blade Runner', year: 1982 }),
        ]);
        matchTitles.mockResolvedValue([
            match({ queryTitle: 'Blade Runner', trailingYear: 2049 }),
        ]);
        const service = createService();

        await service.load();

        expect(service.items()[0].match).toBeNull();
    });

    it('picks the year-compatible row when the catalog holds several', async () => {
        // Two year-stripped rows share one key; the wrong one arrives
        // first. Collapsing before the year check would discard the right
        // one and render the card as "not in your library".
        getTrendingWeek.mockResolvedValue([
            entry({ title: 'Dune', year: 2021 }),
        ]);
        matchTitles.mockResolvedValue([
            match({ queryTitle: 'Dune', trailingYear: 1984, xtreamId: 84 }),
            match({ queryTitle: 'Dune', trailingYear: 2021, xtreamId: 21 }),
        ]);
        const service = createService();

        await service.load();

        expect(service.items()[0].match?.xtreamId).toBe(21);
    });

    it('loads only once for the same language and playlists', async () => {
        const service = createService();

        await service.load();
        await service.load();

        expect(getTrendingWeek).toHaveBeenCalledTimes(1);
    });

    it('loads again in a new TMDB language (localized titles)', async () => {
        const service = createService();
        await service.load();

        language = 'de';
        getTrendingWeek.mockResolvedValueOnce([
            entry({ title: 'Synthetic Localized Title' }),
        ]);
        await service.load();

        expect(getTrendingWeek).toHaveBeenCalledTimes(2);
        expect(service.items()[0].title).toBe('Synthetic Localized Title');
    });

    it('matches again when a playlist is imported or deleted', async () => {
        const service = createService();
        await service.load();
        expect(service.items()[0].match?.playlistId).toBe('pl-1');

        playlists.set([]);
        matchTitles.mockResolvedValueOnce([]);
        await service.load();

        expect(matchTitles).toHaveBeenCalledTimes(2);
        expect(service.items()[0].match).toBeNull();
    });

    it('removes links to a deleted playlist even if TMDB is unreachable', async () => {
        const service = createService();
        await service.load();
        expect(service.items()[0].match?.playlistId).toBe('pl-1');

        playlists.set([]);
        getTrendingWeek.mockResolvedValueOnce([]);
        await service.load();
        expect(service.items()).toHaveLength(1);
        expect(service.items()[0].match).toBeNull();
    });

    it('loads the new language even if the in-flight request returns nothing', async () => {
        let finish!: (entries: TmdbTrendingEntry[]) => void;
        getTrendingWeek.mockReturnValueOnce(
            new Promise<TmdbTrendingEntry[]>((resolve) => (finish = resolve))
        );
        getTrendingWeek.mockResolvedValueOnce([
            entry({ title: 'Synthetic Local Title' }),
        ]);
        const service = createService();
        const pending = service.load();

        language = 'de';
        await service.load();
        expect(getTrendingWeek).toHaveBeenCalledTimes(1);

        finish([]);
        await pending;
        expect(getTrendingWeek).toHaveBeenCalledTimes(2);
        expect(service.items()[0].title).toBe('Synthetic Local Title');
    });

    it('retries on the next visit when the first load came back empty', async () => {
        getTrendingWeek.mockResolvedValueOnce([]);
        const service = createService();

        await service.load();
        expect(service.items()).toEqual([]);

        await service.load();
        expect(getTrendingWeek).toHaveBeenCalledTimes(2);
        expect(service.items()).toHaveLength(1);
    });
});

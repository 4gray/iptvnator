import { TestBed } from '@angular/core/testing';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { CatalogTitleMatchService } from './catalog-title-match.service';
import { CrossPortalSimilarService } from './cross-portal-similar.service';

describe('CrossPortalSimilarService', () => {
    const rec = (title: string, year: number | null = 1999) => ({
        tmdbId: 1,
        title,
        year,
        posterUrl: null,
    });

    const match = (
        overrides: Partial<CatalogTitleMatch> = {}
    ): CatalogTitleMatch => ({
        queryTitle: 'The Matrix',
        playlistId: 'pl-1',
        playlistName: 'Portal One',
        categoryId: 7,
        xtreamId: 42,
        type: 'movie',
        trailingYear: null,
        ...overrides,
    });

    let matchTitles: jest.Mock;
    let isAvailable: boolean;

    function createService(): CrossPortalSimilarService {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: CatalogTitleMatchService,
                    useValue: {
                        get isAvailable() {
                            return isAvailable;
                        },
                        matchTitles,
                    },
                },
            ],
        });
        return TestBed.inject(CrossPortalSimilarService);
    }

    beforeEach(() => {
        isAvailable = true;
        matchTitles = jest.fn().mockResolvedValue([match()]);
    });

    it('resolves to [] in the PWA', async () => {
        isAvailable = false;
        const service = createService();
        await expect(
            service.matchRecommendations([rec('The Matrix')], 'movie')
        ).resolves.toEqual([]);
        expect(matchTitles).not.toHaveBeenCalled();
    });

    it('returns matched recommendations with navigation targets', async () => {
        const service = createService();
        const items = await service.matchRecommendations(
            [rec('The Matrix'), rec('Unmatched Title')],
            'movie'
        );

        expect(items).toHaveLength(1);
        expect(items[0].match.playlistName).toBe('Portal One');
        expect(service.buildLink(items[0])).toEqual([
            '/workspace/xtreams',
            'pl-1',
            'vod',
            '7',
            '42',
        ]);
    });

    it('excludes the current playlist but keeps other playlists', async () => {
        matchTitles.mockResolvedValue([
            match({ playlistId: 'current' }),
            match({ playlistId: 'other', playlistName: 'Portal Two' }),
        ]);
        const service = createService();

        const items = await service.matchRecommendations(
            [rec('The Matrix')],
            'movie',
            { excludePlaylistId: 'current' }
        );

        expect(items).toHaveLength(1);
        expect(items[0].match.playlistId).toBe('other');
    });

    it('drops type mismatches and year-incompatible matches', async () => {
        matchTitles.mockResolvedValue([
            match({ type: 'series' }),
            match({ queryTitle: 'Blade Runner', trailingYear: 2049 }),
        ]);
        const service = createService();

        const items = await service.matchRecommendations(
            [rec('The Matrix'), rec('Blade Runner', 1982)],
            'movie'
        );

        expect(items).toEqual([]);
    });
});

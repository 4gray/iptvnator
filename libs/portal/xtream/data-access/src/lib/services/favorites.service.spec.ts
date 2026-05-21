import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { XTREAM_DATA_SOURCE } from '../data-sources/xtream-data-source.interface';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
    let service: FavoritesService;
    let dataSource: {
        addFavorite: jest.Mock;
        getFavorites: jest.Mock;
        isFavorite: jest.Mock;
        removeFavorite: jest.Mock;
    };

    beforeEach(() => {
        dataSource = {
            addFavorite: jest.fn().mockResolvedValue(undefined),
            getFavorites: jest.fn().mockResolvedValue([
                {
                    id: 202,
                    type: 'movie',
                    title: 'Movie One',
                    poster_url: 'movie.png',
                    added_at: '2026-05-21T12:00:00.000Z',
                    category_id: '20',
                    xtream_id: 202,
                },
            ]),
            isFavorite: jest.fn().mockResolvedValue(true),
            removeFavorite: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                FavoritesService,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
            ],
        });

        service = TestBed.inject(FavoritesService);
    });

    it('uses the active Xtream data source for favorite mutations and reads', async () => {
        await service.addToFavorites({
            content_id: 202,
            playlist_id: 'playlist-1',
            backdrop_url: 'backdrop.jpg',
        });
        await service.removeFromFavorites(202, 'playlist-1');
        await expect(service.isFavorite(202, 'playlist-1')).resolves.toBe(true);
        await expect(
            firstValueFrom(service.getFavorites('playlist-1'))
        ).resolves.toEqual([
            expect.objectContaining({
                content_id: 202,
                playlist_id: 'playlist-1',
                type: 'movie',
                title: 'Movie One',
                poster_url: 'movie.png',
                category_id: 20,
                xtream_id: 202,
            }),
        ]);

        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            202,
            'playlist-1',
            'backdrop.jpg'
        );
        expect(dataSource.removeFavorite).toHaveBeenCalledWith(
            202,
            'playlist-1'
        );
        expect(dataSource.isFavorite).toHaveBeenCalledWith(202, 'playlist-1');
        expect(dataSource.getFavorites).toHaveBeenCalledWith('playlist-1');
    });
});

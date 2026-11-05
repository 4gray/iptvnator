import { TestBed } from '@angular/core/testing';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';

describe('PWA cold VOD favorite actions', () => {
    const credentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'demo',
    };
    const api = { getStreams: jest.fn() };
    let source: PwaXtreamDataSource;
    beforeEach(() => {
        localStorage.clear();
        api.getStreams.mockReset();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: XtreamApiService, useValue: api },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: () =>
                            of({ _id: 'p1', title: 'Portal', ...credentials }),
                    },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        lockedXtreamIds: () => [],
                    },
                },
            ],
        });
        source = TestBed.inject(PwaXtreamDataSource);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('saves a favorite without rewriting independent Recent when history storage is full', async () => {
        api.getStreams.mockResolvedValue([
            { stream_id: 42, name: 'Duna', category_id: '2656' },
        ]);
        const recent = JSON.stringify({
            p1: [
                {
                    id: 'movie:42',
                    viewedAt: '2026-10-26T10:00:00Z',
                    collectionItem: {
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Duna',
                    },
                },
            ],
        });
        localStorage.setItem('xtream-recent-items', recent);
        const set = localStorage.setItem.bind(localStorage);
        const writes = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation((key, value) => {
                if (key === 'xtream-recent-items')
                    throw new DOMException(
                        'Storage full',
                        'QuotaExceededError'
                    );
                set(key, value);
            });
        const ref = {
            id: 42,
            type: 'movie' as const,
            identity: { tmdbId: 100, releaseYear: 2024 },
        };
        await source.addFavorite(ref, 'p1');
        expect(await source.isFavorite(ref, 'p1')).toBe(true);
        expect((await source.getFavorites('p1'))[0]).toMatchObject({
            tmdb_id: 100,
            release_year: 2024,
        });
        expect(localStorage.getItem('xtream-recent-items')).toBe(recent);
        expect(
            writes.mock.calls.some(([key]) => key === 'xtream-recent-items')
        ).toBe(false);
    });

    it.each([undefined, 100])(
        'hydrates the typed catalog before saving a new cold favorite (tmdb=%p)',
        async (tmdb_id) => {
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    name: 'Duna',
                    category_id: '2656',
                    container_extension: null,
                    tmdb_id,
                },
            ]);
            const ref = {
                id: 42,
                type: 'movie' as const,
                identity: { tmdbId: 100, releaseYear: 2024 },
            };
            await source.setContentMetadataIfMissing(ref, 'p1', ref.identity);
            expect(api.getStreams).not.toHaveBeenCalled();
            await source.addFavorite(ref, 'p1');
            expect(api.getStreams).toHaveBeenCalledTimes(1);
            expect(api.getStreams).toHaveBeenCalledWith(
                expect.objectContaining(credentials),
                'movie'
            );
            expect(await source.isFavorite(ref, 'p1')).toBe(true);
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                xtream_id: 42,
                type: 'movie',
                title: 'Duna',
                tmdb_id: 100,
                release_year: 2024,
            });
        }
    );

    it('applies detail identity when catalog hydration finishes after the initial backfill', async () => {
        api.getStreams.mockResolvedValue([
            {
                stream_id: 42,
                name: 'Duna',
                category_id: '2656',
                container_extension: null,
            },
        ]);
        const ref = {
            id: 42,
            type: 'movie' as const,
            identity: { tmdbId: 100 },
        };
        await source.setContentMetadataIfMissing(ref, 'p1', ref.identity);
        await source.getContent('p1', credentials, 'movie');
        await source.addFavorite(ref, 'p1');
        expect(await source.isFavorite(ref, 'p1')).toBe(true);
        expect((await source.getFavorites('p1'))[0]).toMatchObject({
            tmdb_id: 100,
        });
    });

    it.each([
        { items: [] },
        {
            items: [
                {
                    stream_id: 42,
                    name: 'Replacement',
                    category_id: '2656',
                    tmdb_id: 200,
                },
            ],
        },
    ])(
        'does not save absent or conflicting hydrated content %p',
        async ({ items }) => {
            api.getStreams.mockResolvedValue(items);
            const ref = {
                id: 42,
                type: 'movie' as const,
                identity: { tmdbId: 100 },
            };
            await expect(source.addFavorite(ref, 'p1')).rejects.toThrow();
            expect(await source.isFavorite(ref, 'p1')).toBe(false);
            expect(await source.getFavorites('p1')).toEqual([]);
        }
    );
});

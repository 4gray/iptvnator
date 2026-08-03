import type { VodDetailsItem } from '@iptvnator/shared/interfaces';
import { startStalkerVodDownload } from './stalker-vod-download';

describe('startStalkerVodDownload', () => {
    it('captures the rendered Stalker movie metadata without changing provider identity', async () => {
        const startDownload = jest.fn().mockResolvedValue({ success: true });
        const deps = {
            playlist: {
                id: 'stalker-1',
                portalUrl: 'https://stalker.example.test',
                macAddress: '00:1A:79:12:34:56',
                title: 'Living Room Portal',
            },
            downloadsService: { startDownload },
            fetchMovieFileId: jest.fn(),
            fetchLinkToPlay: jest
                .fn()
                .mockResolvedValue('https://cdn.example.test/movie.mpg'),
            language: 'de',
        };
        const item = {
            type: 'stalker',
            playlistId: 'stalker-1',
            cmd: '/media/file_42.mpg',
            data: {
                id: '42',
                cmd: '/media/file_42.mpg',
                category_id: '7',
                info: {
                    name: 'Metadata Movie',
                    o_name: 'Original Metadata Movie',
                    description: 'A captured Stalker plot',
                    movie_image:
                        'https://images.example.test/posters/stalker-movie.jpg',
                    tmdb_backdrop:
                        'https://images.example.test/backdrops/stalker-movie.jpg',
                    releasedate: '2024-11-03',
                    genre: 'Drama, Thriller',
                    rating_imdb: '7.7',
                    tmdb_id: 541,
                    actors: 'Stella Star, Mira Moon',
                    director: 'Dorian Vale',
                    tmdb_cast: [],
                    tmdb_directors: [],
                },
            },
        } as unknown as VodDetailsItem;

        await startStalkerVodDownload(item, deps);

        expect(startDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: 'stalker-1',
                playlistName: 'Living Room Portal',
                playlistType: 'stalker',
                portalUrl: 'https://stalker.example.test',
                xtreamId: 42,
                metadataSnapshot: expect.objectContaining({
                    version: 1,
                    language: 'de',
                    mediaKind: 'movie',
                    title: 'Metadata Movie',
                    originalTitle: 'Original Metadata Movie',
                    plot: 'A captured Stalker plot',
                    posterUrl:
                        'https://images.example.test/posters/stalker-movie.jpg',
                    backdropUrl:
                        'https://images.example.test/backdrops/stalker-movie.jpg',
                    providerCategoryId: '7',
                    genres: ['Drama', 'Thriller'],
                    tmdbId: 541,
                    cast: [{ name: 'Stella Star' }, { name: 'Mira Moon' }],
                    creators: [{ name: 'Dorian Vale' }],
                }),
            })
        );
    });

    it('still captures a useful sparse Stalker snapshot', async () => {
        const startDownload = jest.fn().mockResolvedValue({ success: true });
        const item = {
            type: 'stalker',
            playlistId: 'stalker-1',
            cmd: '/media/file_9.mpg',
            data: {
                id: '9',
                cmd: '/media/file_9.mpg',
                title: 'Sparse title',
                info: {
                    name: '   ',
                    rating_imdb: ' ',
                    tmdb_id: ' ',
                },
            },
        } as unknown as VodDetailsItem;

        await startStalkerVodDownload(item, {
            playlist: {
                id: 'stalker-1',
                portalUrl: 'https://stalker.example.test',
                macAddress: '00:1A:79:12:34:56',
            },
            downloadsService: { startDownload },
            fetchMovieFileId: jest.fn(),
            fetchLinkToPlay: jest
                .fn()
                .mockResolvedValue('https://cdn.example.test/movie.mpg'),
        });

        expect(startDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                title: '   ',
                metadataSnapshot: expect.objectContaining({
                    mediaKind: 'movie',
                    title: 'Sparse title',
                }),
            })
        );
        const snapshot = startDownload.mock.calls[0]?.[0]?.metadataSnapshot;
        expect(snapshot).not.toHaveProperty('rating');
        expect(snapshot).not.toHaveProperty('tmdbId');
    });

    it('hands the movie row on so an unflagged one can yield a permanent URL', async () => {
        // The download row stores whatever URL comes back and retry replays
        // it, so a row that needs no temporary link must be recognised as
        // such — a 5 s link would survive only the first attempt.
        const startDownload = jest.fn().mockResolvedValue({ success: true });
        const fetchLinkToPlay = jest
            .fn()
            .mockResolvedValue('https://cdn.example.test/movie.mpg');
        const data = {
            id: '42',
            cmd: 'ffrt3 https://cdn.example.test/movie.mpg',
            use_http_tmp_link: '0',
            use_load_balancing: '0',
            info: { name: 'Static Movie' },
        };

        await startStalkerVodDownload(
            {
                type: 'stalker',
                playlistId: 'stalker-1',
                cmd: data.cmd,
                data,
            } as unknown as VodDetailsItem,
            {
                playlist: {
                    id: 'stalker-1',
                    portalUrl: 'https://stalker.example.test',
                    macAddress: '00:1A:79:12:34:56',
                },
                downloadsService: { startDownload },
                fetchMovieFileId: jest.fn(),
                fetchLinkToPlay,
            }
        );

        expect(fetchLinkToPlay).toHaveBeenCalledWith(
            'https://stalker.example.test',
            '00:1A:79:12:34:56',
            data.cmd,
            expect.objectContaining({
                use_http_tmp_link: '0',
                use_load_balancing: '0',
            })
        );
        expect(startDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://cdn.example.test/movie.mpg',
            })
        );
    });
});

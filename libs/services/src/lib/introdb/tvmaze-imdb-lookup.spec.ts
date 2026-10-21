import {
    TVMAZE_SEARCH_URL,
    pickTvMazeImdbId,
    searchTvMazeImdbId,
} from './tvmaze-imdb-lookup';

const result = (
    name: string,
    premiered: string | null,
    imdb: string | null
) => ({
    score: 0.9,
    show: { name, premiered, externals: { imdb } },
});

describe('pickTvMazeImdbId', () => {
    it('takes the best-ranked show with the same title', () => {
        expect(
            pickTvMazeImdbId(
                [
                    result(
                        'Breaking Bad: Original Minisodes',
                        '2009-02-17',
                        'tt1999999'
                    ),
                    result('Breaking Bad', '2008-01-20', 'tt0903747'),
                ],
                'Breaking Bad'
            )
        ).toBe('tt0903747');
    });

    it('lets a year in the provider title pick between remakes', () => {
        const results = [
            result('The Office', '2001-07-09', 'tt0290978'),
            result('The Office', '2005-03-24', 'tt0386676'),
        ];

        expect(pickTvMazeImdbId(results, 'The Office (2005)')).toBe(
            'tt0386676'
        );
        expect(pickTvMazeImdbId(results, 'The Office')).toBe('tt0290978');
    });

    it('never guesses a different title or a show without an IMDb id', () => {
        expect(
            pickTvMazeImdbId(
                [result('Better Call Saul', '2015-02-08', 'tt3032476')],
                'Breaking Bad'
            )
        ).toBeNull();
        expect(
            pickTvMazeImdbId(
                [result('Breaking Bad', '2008-01-20', null)],
                'Breaking Bad'
            )
        ).toBeNull();
        expect(pickTvMazeImdbId({ error: 'nope' }, 'Breaking Bad')).toBeNull();
    });
});

describe('searchTvMazeImdbId', () => {
    it('searches the cleaned title without season markers', async () => {
        const fetchFn = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => [result('The Boys', '2019-07-26', 'tt1190634')],
        });

        await expect(
            searchTvMazeImdbId(
                'The Boys S05',
                fetchFn as unknown as typeof fetch
            )
        ).resolves.toBe('tt1190634');

        const url = new URL(fetchFn.mock.calls[0][0]);
        expect(`${url.origin}${url.pathname}`).toBe(TVMAZE_SEARCH_URL);
        expect(url.searchParams.get('q')).toBe('The Boys');
    });

    it('is null when TVmaze fails or cannot be reached', async () => {
        const failing = jest.fn().mockResolvedValue({ ok: false });
        const offline = jest.fn().mockRejectedValue(new TypeError('offline'));

        await expect(
            searchTvMazeImdbId(
                'Breaking Bad',
                failing as unknown as typeof fetch
            )
        ).resolves.toBeNull();
        await expect(
            searchTvMazeImdbId(
                'Breaking Bad',
                offline as unknown as typeof fetch
            )
        ).resolves.toBeNull();
    });
});

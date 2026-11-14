import { TestBed } from '@angular/core/testing';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import {
    EMPTY_PICKER_SEARCH,
    searchPickerRows,
} from './multiview-picker-search';
import { MultiviewPickerSearchService } from './multiview-picker-search.service';

const program = (title: string) => ({ title }) as EpgProgram;

describe('searchPickerRows', () => {
    const rows = [
        toPickerRow(liveItem(1, { name: 'Café Noticias' }), [], {
            program: program('Evening Match'),
        }),
        toPickerRow(liveItem(2, { name: 'Match Channel' }), []),
        toPickerRow(movieItem(3, { name: 'The Match' }), []),
        toPickerRow(
            movieItem(4, { name: 'Match Season', contentType: 'series' }),
            []
        ),
    ];
    const titles = (list: readonly { item: { name: string } }[]) =>
        list.map((row) => row.item.name);

    it('groups matches as on air, channels, movies and series', () => {
        const results = searchPickerRows(rows, 'match');

        expect(titles(results.onAir)).toEqual(['Café Noticias']);
        expect(titles(results.channels)).toEqual(['Match Channel']);
        expect(titles(results.movies)).toEqual(['The Match']);
        expect(titles(results.series)).toEqual(['Match Season']);
    });

    it('ignores case and accents and needs every word', () => {
        expect(titles(searchPickerRows(rows, 'CAFE noti').channels)).toEqual([
            'Café Noticias',
        ]);
        expect(searchPickerRows(rows, 'cafe match').channels).toEqual([]);
    });

    it('lists a row once per group', () => {
        const twice = [...rows, rows[1]];

        expect(searchPickerRows(twice, 'match').channels).toHaveLength(1);
    });

    it('returns nothing for a blank term', () => {
        expect(searchPickerRows(rows, '   ')).toBe(EMPTY_PICKER_SEARCH);
    });
});

describe('MultiviewPickerSearchService', () => {
    const searchContent = jest.fn();
    const getPlaylistById = jest.fn();

    beforeEach(() => {
        searchContent.mockReset();
        getPlaylistById.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: XTREAM_DATA_SOURCE, useValue: { searchContent } },
                { provide: PlaylistsService, useValue: { getPlaylistById } },
                {
                    provide: MultiviewOnScreenSources,
                    useValue: { current: () => [] },
                },
            ],
        });
    });

    const loaded = [toPickerRow(liveItem(2, { name: 'Match Channel' }), [])];
    const service = () => TestBed.inject(MultiviewPickerSearchService);

    it('adds films and series of an Xtream playlist from its data source', async () => {
        getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-1',
                title: 'Synthetic Provider',
                serverUrl: 'http://x.example',
            })
        );
        searchContent.mockResolvedValue([
            {
                id: 31,
                xtream_id: 3,
                title: 'The Match',
                type: 'movie',
                poster_url: '',
                category_id: 12,
            },
            {
                id: 41,
                xtream_id: 4,
                title: 'Match Season',
                type: 'series',
                poster_url: '',
            },
            {
                id: 51,
                xtream_id: 5,
                title: 'Match Live',
                type: 'live',
                poster_url: '',
            },
        ]);

        const results = await service().search('match', loaded, 'playlist-1');

        expect(searchContent).toHaveBeenCalledWith(
            'playlist-1',
            'match',
            ['movie', 'series'],
            true
        );
        expect(results.channels.map((r) => r.item.name)).toEqual([
            'Match Channel',
        ]);
        expect(results.movies[0].item).toMatchObject({
            name: 'The Match',
            contentType: 'movie',
            xtreamId: 3,
            playlistName: 'Synthetic Provider',
            categoryId: 12,
        });
        expect(results.series.map((r) => r.kind)).toEqual([null]);
    });

    it('keeps the series when more films than the limit match', async () => {
        getPlaylistById.mockReturnValue(
            of({ _id: 'playlist-1', serverUrl: 'http://x.example' })
        );
        // The data sources list every film before the first series.
        const films = Array.from({ length: 101 }, (_, index) => ({
            id: 100 + index,
            xtream_id: 100 + index,
            title: `Match Film ${index}`,
            type: 'movie',
            poster_url: '',
        }));
        searchContent.mockResolvedValue([
            ...films,
            {
                id: 41,
                xtream_id: 4,
                title: 'Match Season',
                type: 'series',
                poster_url: '',
            },
        ]);

        const results = await service().search('match', loaded, 'playlist-1');

        expect(results.series.map((r) => r.item.name)).toEqual([
            'Match Season',
        ]);
        expect(results.movies.length).toBeLessThanOrEqual(50);
    });

    it('searches only the loaded rows for other playlists', async () => {
        getPlaylistById.mockReturnValue(
            of({ _id: 'm', url: 'https://list.example/a.m3u' })
        );

        const results = await service().search('match', loaded, 'm');

        expect(searchContent).not.toHaveBeenCalled();
        expect(results.channels).toHaveLength(1);
    });

    it('keeps the loaded results when the data source fails', async () => {
        getPlaylistById.mockReturnValue(
            of({ _id: 'playlist-1', serverUrl: 'http://x.example' })
        );
        searchContent.mockRejectedValue(new Error('locked store'));

        const results = await service().search('match', loaded, 'playlist-1');

        expect(results.channels).toHaveLength(1);
        expect(results.movies).toEqual([]);
    });
});

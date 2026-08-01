import type { DownloadItem } from '@iptvnator/services';
import {
    buildDownloadLibrary,
    compareDownloadIds,
    deriveStandardizedSeriesTitle,
    isUsableDownloadOrderNumber,
    type DownloadLibraryRow,
    type DownloadSeriesCardViewModel,
} from './download-library.viewmodel';

const CREATED_AT = '2026-01-01T00:00:00Z';
const MALFORMED_ID_ORDER = [
    'nan',
    'negative-infinity',
    'negative',
    'zero',
    'fractional',
    'unsafe',
    'positive-infinity',
] as const;
const ID_CASES = [
    { id: 7, title: 'valid-7' },
    { id: Number.NaN, title: 'nan' },
    { id: Number.POSITIVE_INFINITY, title: 'positive-infinity' },
    { id: Number.NEGATIVE_INFINITY, title: 'negative-infinity' },
    { id: -3, title: 'negative' },
    { id: 0, title: 'zero' },
    { id: 42.5, title: 'fractional' },
    { id: Number.MAX_SAFE_INTEGER + 1, title: 'unsafe' },
    { id: 2, title: 'valid-2' },
] as const;

function download(
    id: number,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id,
        playlistId: 'playlist-a',
        xtreamId: 1,
        contentType: 'episode',
        seriesXtreamId: 10,
        seasonNumber: 1,
        episodeNumber: 1,
        title: `Episode ${id}`,
        url: 'https://example.test/episode',
        status: 'completed',
        createdAt: CREATED_AT,
        ...overrides,
    };
}

function row(item: DownloadItem): DownloadLibraryRow {
    return {
        item,
        episodeLabel: '',
        sourceName: 'Alpha Source',
    };
}

function buildSeries(
    items: readonly DownloadItem[]
): DownloadSeriesCardViewModel {
    const [entity] = buildDownloadLibrary(items.map(row));
    expect(entity.kind).toBe('series');
    if (entity.kind !== 'series') {
        throw new Error('Expected a grouped series entity');
    }
    return entity;
}

function idEpisodes(
    cases: readonly (typeof ID_CASES)[number][]
): DownloadItem[] {
    return cases.map(({ id, title }) => download(id, { title }));
}

describe('download library view model helpers', () => {
    it('does not derive a series title from a non-episode item', () => {
        const movie = download(1, {
            contentType: 'vod',
            title: 'Movie - S01E02 - Not an episode',
        });

        expect(deriveStandardizedSeriesTitle(movie)).toBeUndefined();
    });

    it('derives the standardized prefix from an episode title', () => {
        const episode = download(1, {
            title: 'Canonical Show - S01E02 - The episode',
        });

        expect(deriveStandardizedSeriesTitle(episode)).toBe('Canonical Show');
    });

    it.each([
        [0, true],
        [1, true],
        [Number.MAX_SAFE_INTEGER, true],
        [1.5, false],
        [Number.MAX_SAFE_INTEGER + 1, false],
        [Number.NaN, false],
        [Number.POSITIVE_INFINITY, false],
        [-1, false],
    ])('classifies %p as usable=%s', (value, expected) => {
        expect(isUsableDownloadOrderNumber(value)).toBe(expected);
    });

    it('returns finite results for duplicate and zero malformed ids', () => {
        expect(compareDownloadIds(3, 3)).toBe(0);
        expect(compareDownloadIds(Number.NaN, Number.NaN)).toBe(0);
        expect(compareDownloadIds(0, Number.NaN)).toBe(1);
    });

    it('keeps a fractional series id as an individual episode card', () => {
        const entities = buildDownloadLibrary([
            row(download(1, { seriesXtreamId: 42.5 })),
        ]);

        expect(entities).toEqual([
            expect.objectContaining({
                kind: 'episode',
                key: 'episode:1',
            }),
        ]);
    });

    it('orders member ids with valid ascending before the documented malformed fallback', () => {
        const expected = ['valid-2', 'valid-7', ...MALFORMED_ID_ORDER];
        const forward = buildSeries(idEpisodes(ID_CASES));
        const reversed = buildSeries(idEpisodes([...ID_CASES].reverse()));

        expect(forward.members.map(({ title }) => title)).toEqual(expected);
        expect(reversed.members.map(({ title }) => title)).toEqual(expected);
    });

    it('chooses the greatest valid id as representative before malformed ids', () => {
        const forward = buildSeries(idEpisodes(ID_CASES));
        const reversed = buildSeries(idEpisodes([...ID_CASES].reverse()));

        expect(forward.representative.title).toBe('valid-7');
        expect(reversed.representative.title).toBe('valid-7');
    });

    it('chooses a malformed representative by canonical fallback independent of input order', () => {
        const malformed = ID_CASES.filter(
            ({ title }) => !title.startsWith('valid')
        );
        const forward = buildSeries(idEpisodes(malformed));
        const reversed = buildSeries(idEpisodes([...malformed].reverse()));

        expect(forward.representative.title).toBe('nan');
        expect(reversed.representative.title).toBe('nan');
    });

    it('sorts fractional and unsafe season or episode values last', () => {
        const unsafe = Number.MAX_SAFE_INTEGER + 1;
        const series = buildSeries([
            download(1, { title: 'valid', seasonNumber: 1, episodeNumber: 2 }),
            download(2, {
                title: 'fractional-season',
                seasonNumber: 1.5,
                episodeNumber: 1,
            }),
            download(3, {
                title: 'unsafe-season',
                seasonNumber: unsafe,
                episodeNumber: 1,
            }),
            download(4, {
                title: 'fractional-episode',
                seasonNumber: 1,
                episodeNumber: 1.5,
            }),
            download(5, {
                title: 'unsafe-episode',
                seasonNumber: 1,
                episodeNumber: unsafe,
            }),
        ]);

        expect(series.members.map(({ title }) => title)).toEqual([
            'valid',
            'fractional-episode',
            'unsafe-episode',
            'fractional-season',
            'unsafe-season',
        ]);
    });

    it('ignores fractional and unsafe seasons when deriving the range', () => {
        const unsafe = Number.MAX_SAFE_INTEGER + 1;
        const series = buildSeries([
            download(1, { seasonNumber: 2 }),
            download(2, { seasonNumber: 1.5 }),
            download(3, { seasonNumber: unsafe }),
        ]);

        expect(series.firstSeason).toBe(2);
        expect(series.lastSeason).toBe(2);
    });
});
